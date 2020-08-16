'use strict';
const config = require('./config/config.js');
const { wait, mailer } = require('./utilities');
const ccxt = require('ccxt');
const coinbasepro_credential = config.credential.coinbase_dca;
const fs = require('fs');

let coinbasepro = new ccxt.coinbasepro({
    apiKey: coinbasepro_credential.apikey,
    secret: coinbasepro_credential.base64secret,
    password: coinbasepro_credential.passphrase
});

let exchange_scope = {
    coinbasepro
};

const period_h = 4;
const bin_size = 5;
const price_lowerb_pc = 5;
const price_upperb_pc = 10;
const trade_mode = 'buy_sell'; //'buy_only' 'sell_only' 'buy_sell'
const prouduct_scope = ['BTC/GBP', 'ETH/GBP'];
const quote_currency = 'GBP';

const main = async () => {

    // check through all open orders and filter out buy limit orders... to do: to also check if product_scope.includes('info.proudct_id')
    for (const exchange in exchange_scope) {
        let open_orders = await exchange_scope[exchange].fetchOpenOrders();
        console.log(`${exchange}: ${open_orders.length} open orders found`);
        await reset_buy_limit_orders(exchange, open_orders, trade_mode);
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
            console.log(product_price);

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
    console.log(req_obj);
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
                    await exchange_scope[exchange].cancelOrder(req.id);
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
const aoc_minute = 0;

const main_timer = setInterval(() => {

    let tmstmp_current = new Date();
    let hour = tmstmp_current.getHours();
    let minute = tmstmp_current.getMinutes();

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
        }
    } else {
        aoc_done = false;
    }

    // scheduled daily email notification
    if (hour === email_hour && minute === email_minute) {
        if (!email_sent) {
            email_sent = true;
            console.log('email AoC report');
        }
    } else {
        email_sent = false;
    }



}, 1000)
