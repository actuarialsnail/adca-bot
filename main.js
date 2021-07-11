'use strict';
const { wait, send_mail } = require('./utilities');
const WebSocket = require('ws');
const config = require('./config/config.js');
const ccxt = require('ccxt');
const coinbasepro_credential = config.credential.coinbase_dca;
const binance_credential = config.credential.binance;
const kraken_credential = config.credential.kraken_adca;
const fs = require('fs');
const CoinbasePro = require('coinbase-pro');
const taapi = require("taapi");

const taapi_client = taapi.client(config.credential.taapi.secret);

let coinbasepro = new ccxt.coinbasepro({
    apiKey: coinbasepro_credential.apikey,
    secret: coinbasepro_credential.base64secret,
    password: coinbasepro_credential.passphrase
});
let binance = new ccxt.binance({
    apiKey: binance_credential.apiKey,
    secret: binance_credential.secretKey,
});
let kraken = new ccxt.kraken({
    apiKey: kraken_credential.api,
    secret: kraken_credential.private_key,
});

let exchange_scope = {
    // coinbasepro,
    binance,
    kraken,
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
            }, 60 * 60 * 1000 - 2)
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
    setInterval(init_ws, 60 * 60 * 1000 - 1); // as per binance API, user datastream resets every hour
}

const kraken_ws = async () => {
    const kraken_listenkey = await kraken.privatePostGetWebSocketsToken();
    // console.log(kraken_listenkey);
    let msg_init = true;

    const ws = new WebSocket('wss://ws-auth.kraken.com');
    let kraken_heartbeat_timeout;
    ws.on('open', () => {
        console.log('kraken websocket connected at:', new Date());
        ws.send(JSON.stringify({
            "event": "subscribe",
            "subscription":
            {
                "name": "ownTrades",
                "token": kraken_listenkey.result.token,
            }
        }));
        ws.send(JSON.stringify({
            "event": "subscribe",
            "subscription":
            {
                "name": "openOrders",
                "token": kraken_listenkey.result.token,
            }
        }));

    })

    ws.on('message', (msg_text) => {
        let msg = JSON.parse(msg_text);

        if (msg.event === 'heartbeat') {
            // clears old timeout
            clearTimeout(kraken_heartbeat_timeout);
            // sets new timeout
            kraken_heartbeat_timeout = setTimeout(() => {
                console.log('ERROR', 'Websocket error', 'No heartbeat for 10s... reconnecting');
                try { ws.terminate() } catch (err) { kraken_ws(); };
            }, 10 * 1000);
        } else {
            if (Array.isArray(msg)) {
                const channel_name = msg.slice(-1)[0];
                console.log(channel_name, 'publication received at', new Date());
                if (channel_name === 'ownTrades' && !msg_init) {
                    let tradesArr = msg[0];
                    tradesArr.forEach(tradeObj => {
                        for (const [, trade] of Object.entries(tradeObj)) {
                            if (trade.type === 'buy' && trade.ordertype === 'limit') {
                                console.log('kraken limit buy order trade detected');
                                const dec = 2;
                                const price = Math.floor(Number(trade.price) * (1 + price_upperb_pc / 100) * 10 ** dec) / 10 ** dec;
                                // submit sell limit
                                const symbol = trade.pair;
                                const size = Number(trade.vol);
                                console.log(trade);
                                console.log(`placing limit sell symbol: ${symbol} size: ${size} price: ${price}`);
                                kraken.createOrder(symbol, 'limit', 'sell', size, price);
                                fs.appendFile('./logs/kraken_tradelog.json', JSON.stringify({ trade, size, price }) + '\n', (err) => {
                                    if (err) { console.log('error writing log files', err) }
                                })
                            }
                        }
                    });
                } else if (channel_name === 'ownTrades') {
                    msg_init = false
                }
            }
            // console.log(JSON.stringify(msg));
        }
    })

    ws.on('error', err => {
        /* handle error */
        console.log('error', err);
    });

    ws.on('close', () => {
        console.log('ERROR', 'Websocket Error', `websocket closed. Attempting to re-connect.`);
        setTimeout(() => {
            kraken_ws();
        }, 3000)
    });
}

for (const exchange in exchange_scope) {

    switch (exchange) {
        case "coinbasepro":
            // coinbasepro_ws();
            break;
        case "binance":
            // binance_ws();
            break;
        case "kraken":
            // kraken_ws();
            break;
        default:
            console.log(`unrecognised exchange ${exchange}`);
            break;
    }
}

const main = async () => {

    const bb_lower = {};
    const rsi = {};
    // pre-load periodic technical indicators
    for (const product of prouduct_scope) {
        const api_res_bb = await taapi_client.getIndicator(
            "bbands", "binance", product, config.settings.indicators.bbands.timeframe,
            {
                optInTimePeriod: config.settings.indicators.bbands.period,
                optInNbDevDn: config.settings.indicators.bbands.std,
            }
        );
        const api_res_rsi = await taapi_client.getIndicator(
            "rsi", "binance", product, config.settings.indicators.rsi.timeframe,
            {
                optInTimePeriod: config.settings.indicators.rsi.period,
            }
        );

        bb_lower[product] = api_res_bb.valueLowerBand;
        rsi[product] = api_res_rsi.value;
    }

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
        if (exchange === 'kraken') {
            // .free attribute is not available from kraken API but ok to use total given buy limits are already cleared
            balance[exchange] = (await exchange_scope[exchange].fetchBalance())[quote_currency].total;
        } else {
            balance[exchange] = (await exchange_scope[exchange].fetchBalance())[quote_currency].free;
        }
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
            const product_max_budget = Math.floor(balance[exchange] / prouduct_scope.length * 10 ** dec) / (10 ** dec);
            const product_budget = Math.min(product_max_budget, config.settings.exchanges[exchange].budget_abs[product])
            console.log(`${exchange} budget set for ${product}: ${product_budget}`);
            // const product_budget = 250; // for testing only

            // request best bid/offer
            const product_price = await coinbasepro.fetchTicker(product);
            console.log('product price', product_price);

            const start = product_price.bid;
            const end = Math.min(start * (1 - price_lowerb_pc / 100), bb_lower[product]);
            console.log(`start price: ${start} end price: ${end}, lower of ${price_lowerb_pc}% and ${bb_lower[product]}`);
            const trend_type = determine_trend_type(rsi);
            console.log(`trend type determined: ${trend_type}`);
            orders[product] = create_buy_limit_param_array(start, end, bin_size, product_info, product_budget, trend_type);
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
const create_buy_limit_param_array = (start, end, bin_size, info, budget, trend) => {

    let order_param_array = [];

    const delta_price = (start - end) / (bin_size) //first limit order with start less one step

    // for rounding
    const dec_size = info.precision.amount;
    const dec_price = info.precision.price;

    let step_size = [];
    let step_price = [];

    for (let i = 1; i <= bin_size; i++) {

        step_price[i] = Math.floor((start - delta_price * i) * 10 ** dec_price) / 10 ** dec_price;
        switch (trend) {
            case 'hyperbolic':
                // squared increasing weights
                step_size[i] = Math.floor(budget * i ** 2 / (bin_size * (bin_size + 1) * (2 * bin_size + 1) / 6) / (1 + info.maker) / step_price[i] * 10 ** dec_size) / 10 ** dec_size;
                break;
            case 'bull':
                // linearly increasing weights
                step_size[i] = Math.floor(budget * i / bin_size / ((bin_size + 1) / 2) / (1 + info.maker) / step_price[i] * 10 ** dec_size) / 10 ** dec_size;
                break;
            case 'range':
                // flat or no increasing weights - use the arithmetic progression Sn = n(a1+an)/2
                step_size[i] = Math.floor(budget / (bin_size * (start + end) / 2 * (1 + info.maker)) * 10 ** dec_size) / 10 ** dec_size;
                break;
            case 'bear':
                // inverse-linearly increasing weights
                step_size[i] = Math.floor(budget * (bin_size - i + 1) / bin_size / ((bin_size + 1) / 2) / (1 + info.maker) / step_price[i] * 10 ** dec_size) / 10 ** dec_size;
                break;
            default:
                // flat or no increasing weights
                step_size[i] = Math.floor(budget / (bin_size * (start + end) / 2 * (1 + info.maker)) * 10 ** dec_size) / 10 ** dec_size;
                break;
        }

        // validation, execute if trade parameters are within limits       
        const quote = step_size[i] * step_price[i];
        if (step_size[i] < info.limits.amount.min) {
            console.log(`base size ${step_size[i]} is below the minimum ${info.limits.amount.min} for ${step_price[i]} limit order`)
        } else if (quote < info.limits.cost.min) {
            console.log(`quote size ${quote} (${step_size[i]} * ${step_price[i]}) is below the minimum ${info.limits.cost.min}`)
        } else {
            order_param_array.push({ symbol: info.symbol, price: step_price[i], size: step_size[i], side: 'buy', type: 'limit' })
        }
    }

    // console.log(order_param_array);
    return order_param_array;
}

// determination of past trend
const determine_trend_type = (rsi_ind) => {
    let trend_type = "";
    if (rsi_ind > 80) {
        trend_type = 'hyperbolic'
    } else if (rsi_ind > 60) {
        trend_type = 'bull'
    } else if (rsi_ind > 30) {
        trend_type = 'range'
    } else {
        trend_type = 'bear'
    }
    return trend_type;
}

const batch_request = async (exchange, req_obj) => {
    // console.log('request object', req_obj);
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

main();

const main_timer = setInterval(async () => {

    let tmstmp_current = new Date();
    let hour = tmstmp_current.getHours();
    let minute = tmstmp_current.getMinutes();
    const yesterday = new Date(tmstmp_current)
    yesterday.setDate(yesterday.getDate() - 1)

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

}, 1000)