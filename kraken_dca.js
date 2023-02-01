'use strict';
const ccxt = require('ccxt');
const config = require('./config/config_kraken.js');
const _config = require('./config/config.js');

const { wait, send_mail } = require('./utilities');

const kraken_credential = config.credential;

let kraken = new ccxt.kraken({
    apiKey: kraken_credential.apiKey,
    secret: kraken_credential.secretKey,
});

const taapi = require("taapi");
const taapi_client = taapi.client(_config.credential.taapi.secret);

let sandbox = false;
let manual_dca = false;
let manual_dip = false;
const myArgs = process.argv.slice(2);
switch (myArgs[0]) {
    case 'test':
        sandbox = true;
        console.log('Sandbox mode is on');
        break;
    case 'dca':
        manual_dca = true;
        console.log('Manual DCA is activated');
        break;
    case 'dip':
        manual_dip = true;
        console.log('Manual Dip nets activated');
        break;
    default:
}

const { bin_size, price_lowerb_pc1, price_lowerb_pc2, prouduct_scope, quote_currency, budget_abs, price_sell_margin_pc } = config.settings;

let budget_abs_total = 0;
for (const product of prouduct_scope) {
    budget_abs_total += budget_abs[product];
}

// add condition check - needs to be range bound for grid trading
let range_bound = {}

const dca = async () => {

    const markets_info = await kraken.loadMarkets();
    const total_budget = (await kraken.fetchBalance())[quote_currency].free;

    if (budget_abs_total > total_budget) {
        console.log('insufficient free quote currency to DCA');
    } else {
        for (const product of prouduct_scope) {
            const product_info = markets_info[product];
            const product_budget = budget_abs[product];
            const product_price = (await kraken.fetchTicker(product)).ask;
            const param = create_buy_param_array(product_info, product_budget, product_price);
            param ? await batch_request([param]) : null;
        }
    }
}

const dip = async () => {

    // perform cancellation to all orders first to fully utilise budget
    for (const product of prouduct_scope) {
        if (range_bound[product]) {
            let open_orders = await kraken.fetchOpenOrders(product);
            console.log(`${open_orders.length} open orders found for ${product}`);
            open_orders.length > 0 ? await reset_buy_limit_orders(open_orders) : null;
            console.log(`${product} buy limit orders cancelled`);
        } else {
            console.log(`${product} range bound is ${range_bound[product]}`);
        }
    }
    // determine total budget
    // .free attribute is not available from kraken API but ok to use total given buy limits are already cleared
    const total_budget = (await kraken.fetchBalance())[quote_currency].total;
    for (const product of prouduct_scope) {
        range_bound[product] ? await create_buy_limit_orders(product, total_budget) : null;
    }
}

const create_buy_param_array = (info, budget, price) => {

    // for rounding
    const dec_size = info.precision.amount;
    const dec_price = info.precision.price;

    const quote = Math.ceil(budget * 10 ** dec_price) / 10 ** dec_price;
    const size = Math.ceil(quote / (1 + info.taker) / price * 10 ** dec_size) / 10 ** dec_size;

    // console.log(price, quote, size);

    if (size < info.limits.amount.min) {
        console.log(`${info.symbol}: base size ${size} is below the minimum ${info.limits.amount.min} for ${price} limit order`)
    } else if (quote < info.limits.cost.min) {
        console.log(`${info.symbol}: quote size ${quote} (${size} * ${price}) is below the minimum ${info.limits.cost.min}`)
    } else {
        return { symbol: info.symbol, quoteOrderQty: quote, side: 'buy', type: 'market' };
    }
}

const cancel_all_buy_limit_orders = async (product) => {
    const cancel_obj = { symbol: product, type: 'cancel' }
    await batch_request([cancel_obj]);
}

const create_buy_limit_orders = async (product, total_budget) => {
    const markets_info = await kraken.loadMarkets();
    const product_info = markets_info[product];
    console.log(`total budget ${total_budget}`);
    console.log(`budget for DCA ${budget_abs_total}`);
    const product_budget = (total_budget - budget_abs_total) * budget_abs[product] / budget_abs_total;
    console.log(`budget for ${product}: ${product_budget}`);
    // request best bid/offer
    const product_price = await kraken.fetchTicker(product);
    // console.log('product price', product_price);
    const start = Math.min(product_price.bid * (1 - price_lowerb_pc1 / 100));
    const end = Math.min(product_price.bid * (1 - price_lowerb_pc2 / 100));

    const orders = create_buy_limit_param_array(start, end, bin_size, product_info, product_budget);
    console.log(`sending buy limit orders for ${product}`);
    await batch_request(orders);
}

// order param array builder
const create_buy_limit_param_array = (start, end, bin_size, info, budget) => {

    let order_param_array = [];

    const delta_price = (start - end) / (bin_size) //first limit order with start less one step

    // for rounding
    const dec_size = info.precision.amount;
    const dec_price = info.precision.price;

    let step_size = [];
    let step_price = [];
    let step_price_sell_margin;

    for (let i = 1; i <= bin_size; i++) {

        step_price[i] = Math.floor((start - delta_price * i) * 10 ** dec_price) / 10 ** dec_price;
        step_price_sell_margin = Math.floor(step_price[i] * (1 + price_sell_margin_pc / 100) * 10 ** dec_price) / 10 ** dec_price;

        // flat or no increasing weights
        step_size[i] = Math.floor(budget / (bin_size * (start + end) / 2 * (1 + info.maker)) * 10 ** dec_size) / 10 ** dec_size;

        // validation, execute if trade parameters are within limits       
        const quote = step_size[i] * step_price[i];
        if (step_size[i] < info.limits.amount.min) {
            console.log(`base size ${step_size[i]} is below the minimum ${info.limits.amount.min} for ${step_price[i]} limit order`)
        } else if (quote < info.limits.cost.min) {
            console.log(`quote size ${quote} (${step_size[i]} * ${step_price[i]}) is below the minimum ${info.limits.cost.min}`)
        } else {
            order_param_array.push({
                symbol: info.symbol, price: step_price[i], size: step_size[i], side: 'buy', type: 'limit',
                params: { 'close[ordertype]': 'limit', 'close[price]': step_price_sell_margin, 'userref': 777 }
            })
        }
    }

    // console.log(order_param_array);
    return order_param_array;
}

const reset_buy_limit_orders = async (open_orders) => {

    const cancel_obj = create_cancel_param_obj(open_orders);
    await batch_request(cancel_obj);

}

const create_cancel_param_obj = (open_orders) => {
    let order_param_obj = [];
    let count = 0;
    for (const open_order of open_orders) {
        // console.log(open_order)
        if (open_order.side === 'buy' && open_order.type === 'limit') {
            count++;
            const { symbol, id, price, amount } = open_order;
            order_param_obj.push({ symbol, type: 'cancel', id, price, amount });
        }
    }
    console.log(`${count} buy limit orders found to be reset`);
    return order_param_obj;
}

const batch_request = async (req_arr) => {
    for (const req of req_arr) {
        const { symbol, type, side, size, price, quoteOrderQty, params } = req;
        switch (type) {
            case 'market':
                // console.log(`sending market order request`, req);
                if (!sandbox) {
                    const order = await kraken.create_order(symbol, type, side, null, null, { quoteOrderQty }) // to specify costs
                    // console.log(order)
                    await wait(100);
                } else {
                    console.log('Sandbox mode is on.');
                }
                break;
            case 'limit':
                // console.log(`sending limit order request`, req);
                if (!sandbox) {
                    await kraken.createOrder(symbol, type, side, size, price, params);
                    await wait(100);
                } else {
                    console.log('Sandbox mode is on.');
                }
                break;
            case 'cancel':
                // console.log(`sending cancel order request`, req);
                if (!sandbox) {
                    await kraken.cancelOrder(req.id, symbol);
                    await wait(100);
                } else {
                    console.log('Sandbox mode is on.');
                }
                break;
            default:
                console.log('unkown type detected, request not executed');
                break;
        }
    }
}

let limits_reset = false;
let taapi_trigger = false;

if (sandbox) {
    dca();
    dip();
}
manual_dca ? dca() : null;
manual_dip ? dip() : null;

const main_timer = setInterval(async () => {

    let tmstmp_current = new Date();
    let hour = tmstmp_current.getHours();
    let minute = tmstmp_current.getMinutes();

    if ((minute % 5 === 0)) { //every 5 minutes
        if (!limits_reset) {
            limits_reset = true;
            console.log(`===== ${tmstmp_current.toISOString()} Routine Dip Nets triggered =====`);
            await dip();
            console.log(`===== ${tmstmp_current.toISOString()} Routine Dip Nets completed =====`);
            // console.log(`===== ${tmstmp_current.toISOString()} Routine DCA triggered =====`);
            // await dca();
            // console.log(`===== ${tmstmp_current.toISOString()} Routine DCA completed =====`);
            // send_mail({
            //     subject: "DCA bot routine report",
            //     text: `${tmstmp_current.toISOString()}: Routine Dip Nets and DCA completed`,
            //     to: _config.nodemailRecipients[0],
            //     from: _config.arbitorCoinNodeMailerCred.EMAIL
            // });
        }
    } else {
        limits_reset = false;
    }

    if (minute === 13 || minute === 43) { //every half hour
        if (!taapi_trigger) {
            taapi_trigger = true;
            for (const product of prouduct_scope) {
                const api_res_rsi = await taapi_client.getIndicator(
                    "rsi", "binance", product, config.settings.indicators.rsi.timeframe,
                    {
                        optInTimePeriod: config.settings.indicators.rsi.period,
                    }
                )
                console.log(`${product} rsi is: ${api_res_rsi.value}`)
                if (api_res_rsi.value > 30 && api_res_rsi.value < 70) {
                    range_bound[product] = true;
                } else {
                    range_bound[product] = false;
                }
                await wait(61 * 1000); // prevent E429: API request limit
            }
        }
    } else {
        taapi_trigger = false;
    }

}, 1000)