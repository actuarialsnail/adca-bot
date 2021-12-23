'use strict';
const ccxt = require('ccxt');
const config = require('./config/config_binance.js');
const { wait } = require('./utilities');

const binance_credential = config.credential;

let binance = new ccxt.binance({
    apiKey: binance_credential.apiKey,
    secret: binance_credential.secretKey,
});

let sandbox = false;
const myArgs = process.argv.slice(2);
switch (myArgs[0]) {
    case 'test':
        sandbox = true;
        console.log('Sandbox mode is on');
        break;
    default:
}

const { period_h, bin_size, price_lowerb_pc1, price_lowerb_pc2, prouduct_scope, quote_currency, budget_abs } = config.settings;

const dca = async () => {

    const markets_info = await binance.loadMarkets();

    for (const product of prouduct_scope) {
        const product_info = markets_info[product];
        const product_budget = budget_abs[product];
        const product_price = (await binance.fetchTicker(product)).ask;
        const param = create_buy_param_array(product_info, product_budget, product_price);
        param ? await batch_request([param]) : null;
    }
}

const dip = async () => {
    for (const product of prouduct_scope) {
        let open_orders = await binance.fetchOpenOrders(product);
        console.log(`${open_orders.length} open orders found for ${product}`);
        await reset_buy_limit_orders(open_orders, trade_mode);
        await create_buy_limit_param_array()
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

const reset_buy_limit_orders = async (open_orders) => {

    const cancel_obj = create_cancel_param_obj(open_orders);
    await batch_request(cancel_obj);

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

const batch_request = async (req_arr) => {
    for (const req of req_arr) {
        const { symbol, type, side, size, price, quoteOrderQty } = req;
        switch (type) {
            case 'market':
                console.log(`sending market order request`, req);
                if (!sandbox) {
                    const order = await binance.create_order(symbol, type, side, null, null, { quoteOrderQty }) // to specify costs
                    console.log(order)
                    await wait(100);
                } else {
                    console.log('Sandbox mode is on.');
                }
                break;
            case 'limit':
                console.log(`sending limit order request to ${exchange}`, req);
                if (!sandbox) {
                    await binance.createOrder(symbol, type, side, size, price);
                    await wait(100);
                } else {
                    console.log('Sandbox mode is on.');
                }
                break;
            case 'cancel':
                console.log(`sending cancel order request to ${exchange}`, req);
                if (!sandbox) {
                    await binance.cancelOrder(req.id, req.symbol);
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

// dca();
dip();

const main_timer = setInterval(async () => {

    let tmstmp_current = new Date();
    let hour = tmstmp_current.getHours();
    let minute = tmstmp_current.getMinutes();
    let second = tmstmp_current.getSeconds();

    const yesterday = new Date(tmstmp_current)
    yesterday.setDate(yesterday.getDate() - 1)

    if ((hour === 1) && (minute === 0)) {
        if (!limits_reset) {
            limits_reset = true;
            console.log('Routine DCA triggered');
            dca();
        }
    } else {
        limits_reset = false;
    }

    if (second === 5) {
        dip();
    }

}, 1000)