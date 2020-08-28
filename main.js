'use strict';
const { wait, send_mail } = require('./utilities');
const WebSocket = require('ws');
const config = require('./config/config.js');
const ccxt = require('ccxt');
const coinbasepro_credential = config.credential.coinbase_dca;
const binance_credential = config.credential.binance;
const fs = require('fs');
const CoinbasePro = require('coinbase-pro');

let coinbasepro = new ccxt.coinbasepro({
    apiKey: coinbasepro_credential.apikey,
    secret: coinbasepro_credential.base64secret,
    password: coinbasepro_credential.passphrase
});
let binance = new ccxt.binance({
    apiKey: binance_credential.apiKey,
    secret: binance_credential.secretKey,
});

let exchange_scope = {
    coinbasepro, 
    binance,
};

const { period_h, bin_size, price_lowerb_pc, price_upperb_pc, trade_mode, prouduct_scope, quote_currency } = config.settings;

const coinbasepro_ws = () => {
    let coinbase_timeout;
    const ws = new CoinbasePro.WebsocketClient(
        ['BTC-GBP', 'ETH-GBP'],
        'wss://ws-feed.pro.coinbase.com',
        {
            key: coinbasepro_credential.apikey,
            secret: coinbasepro_credential.base64secret,
            passphrase: coinbasepro_credential.passphrase,
        },
        { channels: ['user'] }
    );

    ws.on('open', () => {
        console.log('coinbase websocket connected at:', new Date());
        coinbase_timeout = setTimeout(() => {
            console.log('scheduled reconnection of coinbase websocket connection');
            try { ws.disconnect() } catch (err) { console.log(err) };
        }, 60 * 60 * 1000); //force restart websocket - avoid ws freezing with no close event firing
    });

    ws.on('message', data => {
        if (data.type === 'heartbeat') {
            // do nothing
        } else {
            console.log('websocket user channel feed:', data);
            if (data.type === 'match' && data.side === 'buy') {
                const dec = 2;
                const price = Math.floor(data.price * (1 + price_upperb_pc / 100) * 10 ** dec) / 10 ** dec;
                // submit sell limit
                coinbasepro.createOrder(data.product_id.replace('-', '/'), 'limit', 'sell', data.size, price);
            }
        }
    });

    ws.on('error', err => {
        console.log('coinbase websocket user channel error:', err);
    });

    ws.on('close', () => {
        console.log('coinbase websocket connection closed, reconnecting in 3s...');
        clearTimeout(coinbase_timeout);
        setTimeout(() => { coinbasepro_ws(); }, 3000);
    });
}

const binance_ws = () => {

    const init_ws = async () => {
        const binance_listenkey = await binance.public_post_userdatastream();
        console.log('binance listenkey obtained', binance_listenkey);
        const ws = new WebSocket('wss://stream.binance.com:9443/ws/' + binance_listenkey.listenKey);

        ws.on('open', () => {
            console.log('binance websocket connected at:', new Date())
            setTimeout(() => {
                ws.close();
            }, 60 * 60 * 1000)
        });

        ws.on('message', msg => {
            // console.log(msg);
            let data;
            try {
                data = JSON.parse(msg);
            } catch (e) {
                console.log('json error', e)
            }

            if (data.e === 'executionReport') {
                console.log('executionReport', data);
                if (data.S === 'BUY' && data.o === 'LIMIT' && data.x === 'TRADE') {
                    const dec = 2;
                    const price = Math.floor(Number(data.p) * (1 + price_upperb_pc / 100) * 10 ** dec) / 10 ** dec;
                    // submit sell limit
                    const symbol = data.s.substring(0, 3) + '/' + data.s.substring(3, 6);
                    binance.createOrder(symbol, 'limit', 'sell', Number(data.l), price);
                }
            }
        });

        ws.on('error', err => {
            console.log('binance websocket user channel error:', err)
        })

        ws.on('close', () => {
            console.log('binance websocket connection closed, reconnecting...');
        })
    }
    init_ws();
    setInterval(init_ws, 60 * 60 * 1000); // as per binance API, user datastream resets every hour
}

coinbasepro_ws();
binance_ws()

const main = async () => {

    // check through all open orders and filter out buy limit orders... to do: to also check if product_scope.includes('info.proudct_id')
    for (const exchange in exchange_scope) {
        for (const product of prouduct_scope) {
            let open_orders = await exchange_scope[exchange].fetchOpenOrders(product);
            console.log(`${exchange}: ${open_orders.length} open orders found for ${product}`);
            await reset_buy_limit_orders(exchange, open_orders, trade_mode);
        }
    }

    // determine budget
    let balance = {}
    for (const exchange in exchange_scope) {
        balance[exchange] = (await exchange_scope[exchange].fetchBalance())[quote_currency].free;
        console.log(`${exchange} total budget ${balance[exchange]}`);
    }

    // set the limit order paramters and execute
    for (const exchange in exchange_scope) {
        // get market info and trade parameters
        let markets_info = await exchange_scope[exchange].loadMarkets();
        let orders = {};

        for (const product of prouduct_scope) {
            const product_info = markets_info[product];
            const dec = product_info.precision.price;
            const product_budget = Math.floor(balance[exchange] / prouduct_scope.length * 10 ** dec) / (10 ** dec);
            // const product_budget = 250; // for testing only

            // request best bid/offer
            const product_price = await coinbasepro.fetchTicker(product);
            console.log('product price', product_price);

            orders[product] = create_buy_limit_param_array(product_price.bid, -price_lowerb_pc, bin_size, product_info, product_budget);
            // console.log(orders[product]);
        }

        if (orders) {
            // console.log('executing orders', orders);
            await batch_request(exchange, orders);
        }
        console.log(`DCA reset routine completed for ${exchange}`);
    }
}

const reset_buy_limit_orders = async (exchange, open_orders, trade_mode) => {

    if (trade_mode === 'buy_only' && exchange_scope[exchange].has['cancelAllOrders']) {
        // use cancell all functionality if exist
        console.log(`sending request to ${exchange}: cancell all ${open_orders.length} orders`)
        // await exchange_scope[exchange].cancelAllOrders(); //might not work if some of the orders are not in product_scope, they should not be touched if so
    } else {
        const cancel_obj = create_cancel_param_obj(open_orders);
        await batch_request(exchange, cancel_obj);
    }
}

const create_cancel_param_obj = (open_orders) => {
    let order_param_obj = {}
    let count = 0;
    for (const open_order of open_orders) {
        // console.log(open_order)
        if (open_order.side === 'buy' && open_order.type === 'limit') {
            count++;
            const { symbol, id, price, amount } = open_order;
            if (!order_param_obj[symbol]) { order_param_obj[symbol] = [] }
            order_param_obj[symbol].push({ symbol, type: 'cancel', id, price, amount });
        }
    }
    console.log(`${count} buy limit orders found to be reset`);
    return order_param_obj;
}

// order param array builder
const create_buy_limit_param_array = (start, delta_pc, bin_size, info, budget) => {

    let order_param_array = [];

    const end = start * (1 + delta_pc / 100);
    const delta_price = (start - end) / (bin_size) //first limit order with start less one step

    // for rounding
    const dec_size = info.precision.amount;
    const dec_price = info.precision.price;

    // for linear weighted sizes, use the arithmetic progression Sn = n(a1+an)/2
    const step_size = Math.floor(budget / (bin_size * (start + end) / 2 * (1 + info.taker)) * 10 ** dec_size) / 10 ** dec_size;

    // validation, execute if trade parameters are within limits
    const lowest_quote = step_size * end;
    if (step_size < info.limits.amount.min) {
        console.log(`base size ${step_size} is below the minimum ${info.limits.amount.min}`)
    } else if (lowest_quote < info.limits.cost.min) {
        console.log(`quote size ${lowest_quote} (${step_size} * ${end}) is below the minimum ${info.limits.cost.min}`)
    } else {
        for (let i = 1; i <= bin_size; i++) {
            const step_price = Math.floor((start - delta_price * i) * 10 ** dec_price) / 10 ** dec_price;
            order_param_array.push({ symbol: info.symbol, price: step_price, size: step_size, side: 'buy', type: 'limit' })
        }
    }

    // console.log(order_param_array);
    return order_param_array;
}

const batch_request = async (exchange, req_obj) => {
    console.log('request object', req_obj);
    for (const product in req_obj) {
        for (const req of req_obj[product]) {
            switch (req.type) {
                case 'limit':
                    const { symbol, type, side, size, price } = req;
                    console.log(`sending limit order request to ${exchange}`, req);
                    await exchange_scope[exchange].createOrder(symbol, type, side, size, price);
                    await wait(500);
                    break;
                case 'cancel':
                    console.log(`sending cancel order request to ${exchange}`, req);
                    await exchange_scope[exchange].cancelOrder(req.id, req.symbol);
                    await wait(500);
                    break;
                default:
                    console.log('unkown type detected, request not executed');
                    break;
            }
        }
    }
}

let limits_reset = false;
let email_sent = false;
const email_hour = 5;
const email_minute = 30;
let aoc_done = false;
const aoc_hour = 5;
const aoc_minute = 10;

main();

const main_timer = setInterval(async () => {

    let tmstmp_current = new Date();
    let hour = tmstmp_current.getHours();
    let minute = tmstmp_current.getMinutes();
    const yesterday = new Date(tmstmp_current)
    yesterday.setDate(yesterday.getDate() - 1)

    const today_date = tmstmp_current.toJSON().slice(0, 10);
    const yesterday_date = yesterday.toJSON().slice(0, 10);

    if ((hour % period_h === 0) && (minute === 0)) {
        // if ((hour % 1 == 0) && (minute % 5 == 0)) {
        if (!limits_reset) {
            limits_reset = true;
            console.log('routine DCA reset triggered');
            main();
        }
    } else {
        limits_reset = false;
    }

    // scheduled daily aoc reporting process
    if (hour === aoc_hour && minute === aoc_minute) {
        if (!aoc_done) {
            aoc_done = true;
            console.log('perform AoC report');
            // record balance file
            const balance = await coinbasepro.fetchBalance();
            fs.writeFileSync('./logs/balance_' + today_date + '.json', JSON.stringify(balance));
            const ticker = {};
            for (const product of prouduct_scope) {
                ticker[product] = await coinbasepro.fetchTicker(product);
            }
            fs.writeFileSync('./logs/ticker_' + today_date + '.json', JSON.stringify(ticker));
            console.log('files logged');
            const data_obj = await aoc(yesterday_date, today_date);
            generate_html(data_obj);
        }
    } else {
        aoc_done = false;
    }

    // scheduled daily email notification
    if (hour === email_hour && minute === email_minute) {
        if (!email_sent) {
            email_sent = true;
            console.log('email AoC report');
            send_mail('aoc', 'Attached.', 'report_' + today_date + '.html');
        }
    } else {
        email_sent = false;
    }
}, 1000)

const generate_html = (data_obj) => {
    // console.log(data_obj);
    const map = {
        '{{date}}': data_obj.t1,
        '{{value}}': data_obj.snapshot.value.toFixed(2),
        '{{return_abs}}': data_obj.delta.transfer_abs.toFixed(2),
        '{{return_pc}}': data_obj.delta.transfer_pc.toFixed(1),
        '{{r_24hr_abs}}': data_obj.delta.value_abs.toFixed(2),
        '{{r_24hr_pc}}': data_obj.delta.value_pc.toFixed(1),
        '{{btc_value}}': data_obj.snapshot.BTC.toFixed(6),
        '{{btc_delta_abs}}': data_obj.delta.BTC_abs.toFixed(6),
        '{{btc_delta_pc}}': data_obj.delta.BTC_abs.toFixed(1),
        '{{eth_value}}': data_obj.snapshot.ETH.toFixed(6),
        '{{eth_delta_abs}}': data_obj.delta.ETH_abs.toFixed(6),
        '{{eth_delta_pc}}': data_obj.delta.ETH_pc.toFixed(1),
        '{{gbp_value}}': data_obj.snapshot.GBP.toFixed(2),
        '{{gbp_delta_abs}}': data_obj.delta.GBP_abs.toFixed(2),
        '{{gbp_delta_pc}}': data_obj.delta.GBP_pc.toFixed(1),
        '{{transfer}}': data_obj.snapshot.transfer.toFixed(2),
    }

    fs.readFile('./template.html', 'utf8', (err, data) => {
        if (err) {
            return console.log(err);
        }
        let result = data;
        for (const item in map) {
            result = result.replace(item, map[item])
        }
        fs.writeFile('./reports/report_' + data_obj.t1 + '.html', result, 'utf8', (err) => {
            if (err) return console.log(err);
        });
    });
}

const aoc = async (t0, t1) => {

    try {
        const t0_balance = require('./logs/balance_' + t0 + '.json');
        const t0_ticker = require('./logs/ticker_' + t0 + '.json');
        const t1_balance = require('./logs/balance_' + t1 + '.json');
        const t1_ticker = require('./logs/ticker_' + t1 + '.json');

        let data_obj = {};
        // estimate total portfolio value
        let t0_value = 0; let t1_value = 0;
        let delta = {}; let snapshot = {};

        for (const product of prouduct_scope) {
            const currency = product.split('/')[0];
            t0_value += t0_ticker[product].bid * t0_balance[currency].total;
            t1_value += t1_ticker[product].bid * t1_balance[currency].total;
            snapshot[currency] = t1_balance[currency].total;
            delta[currency + '_abs'] = t1_balance[currency].total - t0_balance[currency].total;
            delta[currency + '_pc'] = delta[currency + '_abs'] / t0_balance[currency].total;
        }

        t0_value += t0_balance[quote_currency].total;
        t1_value += t1_balance[quote_currency].total;

        snapshot[quote_currency] = t1_balance[quote_currency].total;
        snapshot['value'] = t1_value;

        delta[quote_currency + '_abs'] = t1_balance[quote_currency].total - t0_balance[quote_currency].total;
        delta[quote_currency + '_pc'] = delta[quote_currency + '_abs'] / t0_balance[quote_currency].total;
        delta['value_abs'] = t1_value - t0_value;
        delta['value_pc'] = delta['value_abs'] / t0_value * 100;

        // calculate total transfers in and obtain other ledger data in last 24 hrs
        let after = ''
        let allLedger = []
        while (true) {
            const limit = 100 // change for your limit
            const params = { id: config.coinbase_dca_account_id, after, limit }
            const trades = await coinbasepro.privateGetAccountsIdLedger(params)
            if (trades.length) {
                after = coinbasepro.last_response_headers['Cb-After'];
                allLedger.push(...trades)
            } else {
                break
            }
            // console.log(`after: ${after} `)
        }
        fs.writeFileSync('./logs/ledger_' + t1 + '.json', JSON.stringify(allLedger));
        let transfer_value = 0;
        allLedger.forEach(element => {
            // console.log(element);
            if (element.type === 'transfer') {
                transfer_value += Number(element.amount);
                // console.log(element.created_at, element.amount);
            }
            // filter out ones in last 24hr

        });
        snapshot['transfer'] = transfer_value;
        delta['transfer_abs'] = snapshot['value'] - transfer_value;
        delta['transfer_pc'] = (snapshot['value'] / transfer_value - 1) * 100;

        // work out total change in value % so far
        data_obj = {
            t0,
            t1,
            delta,
            snapshot,
        }
        // console.log(data_obj);
        return data_obj
    } catch (error) {
        console.log(error);
        return;
    }

}