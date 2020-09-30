'use strict';
const config = require('./config/config.js');
const ccxt = require('ccxt');
// console.log(ccxt.exchanges);
const coinbasepro_credential = config.credential.coinbase_dca;
const binance_credential = config.credential.binance;
const kraken_credential = config.credential.kraken_adca;
const WebSocket = require('ws');
const fs = require('fs');
const CoinbasePro = require('coinbase-pro');
const taapi = require("taapi");

(async function () {

    // kraken ws template
    // const exchange = new ccxt.kraken()
    // console.log (exchange.requiredCredentials) // prints required credentials
    // let kraken = new ccxt.kraken({
    //     apiKey: kraken_credential.api,
    //     secret: kraken_credential.private_key,
    // });
    // kraken.checkRequiredCredentials();
    // console.log(kraken)
    // const kraken_ws = async () => {
    //     const kraken_listenkey = await kraken.privatePostGetWebSocketsToken();
    //     console.log(kraken_listenkey);
    //     let msg_init = true;

    //     const ws = new WebSocket('wss://ws-auth.kraken.com');
    //     let kraken_heartbeat_timeout;
    //     ws.on('open', () => {
    //         console.log('kraken websocket connected at:', new Date());
    //         ws.send(JSON.stringify({
    //             "event": "subscribe",
    //             "subscription":
    //             {
    //                 "name": "ownTrades",
    //                 "token": kraken_listenkey.result.token,
    //             }
    //         }));
    //         ws.send(JSON.stringify({
    //             "event": "subscribe",
    //             "subscription":
    //             {
    //                 "name": "openOrders",
    //                 "token": kraken_listenkey.result.token,
    //             }
    //         }));

    //     })

    //     ws.on('message', (msg_text) => {
    //         let msg = JSON.parse(msg_text);

    //         if (msg.event === 'heartbeat') {
    //             // clears old timeout
    //             clearTimeout(kraken_heartbeat_timeout);
    //             // sets new timeout
    //             kraken_heartbeat_timeout = setTimeout(() => {
    //                 console.log('ERROR', 'Websocket error', 'No heartbeat for 10s... reconnecting');
    //                 try { ws.terminate() } catch (err) { kraken_ws(); };
    //             }, 10 * 1000);
    //         } else {
    //             msg_init = false;
    //             if (Array.isArray(msg) && !msg_init) {
    //                 const channel_name = msg.slice(-1)[0];
    //                 console.log(`${channel_name} publication received`)
    //                 if (channel_name === 'ownTrades') {
    //                     let trades = msg[0];
    //                     trades.forEach(trade => {
    //                         if (trade.type === 'buy' && trade.ordertype === 'limit') {
    //                             const dec = 2;
    //                             const price = Math.floor(Number(trade.price) * (1 + price_upperb_pc / 100) * 10 ** dec) / 10 ** dec;
    //                             // submit sell limit
    //                             const symbol = trade.pair;
    //                             kraken.createOrder(symbol, 'limit', 'sell', Number(msg.vol), price);
    //                         }
    //                     });
    //                 }
    //                 fs.appendFile('./logs/kraken_test.json', JSON.stringify(msg) + '\n', (err) => {
    //                     if (err) { console.log('error writing log files', err) }
    //                 })
    //             }
    //             // console.log(JSON.stringify(msg));
    //         }
    //     })

    //     ws.on('error', err => {
    //         /* handle error */
    //         console.log('error', err);
    //     });

    //     ws.on('close', () => {
    //         console.log('ERROR', 'Websocket Error', `websocket closed. Attempting to re-connect.`);
    //         setTimeout(() => {
    //             kraken_ws();
    //         }, 3000)
    //     });
    // }
    // kraken_ws();
    // const balance = await kraken.fetchBalance()
    // console.log(balance['GBP'].total);

    // const taapi_client = taapi.client(config.credential.taapi.secret);
    // const api_res = await taapi_client.getIndicator(
    //     "bbands", "binance", "BTC/GBP", config.settings.indicators.bbands.timeframe,
    //     {
    //         optInTimePeriod: config.settings.indicators.bbands.period,
    //         optInNbDevDn: config.settings.indicators.bbands.std,
    //     }
    // );
    // console.log(api_res.valueLowerBand);
    // console.log(await client.getIndicator("bbands", "binance", "BTC/GBP", "1d", { optInTimePeriod: 20 }).valueLowerBand);
    // console.log(await client.getIndicator("bbands", "binance", "BTC/GBP", "1d", { optInTimePeriod: 5 }).valueLowerBand);

    // const orderbook = new CoinbasePro.Orderbook();
    // const orderbookSync = new CoinbasePro.OrderbookSync(['BTC-USD', 'ETH-USD']);
    // let counter = 0;
    // setInterval(() => {
    //     fs.appendFile('./logs/orderbooks/test.json', JSON.stringify(orderbookSync.books['ETH-USD'].state()) + '\n', (err) => {
    //         if (err) { console.log('error writing log files', err) }
    //     })
    //     console.log(counter++);
    // }, 1000);

    // const websocket = new CoinbasePro.WebsocketClient(['BTC-USD'], 'wss://ws-feed.pro.coinbase.com', null, { channels: ['ticker', 'level2'] });
    // let tmstmp;
    // let heartbeat_timeout;

    // websocket.on('open', (data) => {
    //     tmstmp = Date.now();
    //     console.log(data);
    //     console.log(`coinbase websocket connected at ${tmstmp}, id: ${JSON.stringify(websocket)}`)
    // })

    // websocket.on('message', data => {
    //     /* work with data */
    //     // console.log(data);
    //     if (data.type === 'heartbeat') {
    //         // clears old timeout
    //         clearTimeout(heartbeat_timeout);
    //         // sets new timeout
    //         heartbeat_timeout = setTimeout(() => {
    //             console.log('ERROR', 'Websocket error', 'No heartbeat for 10s... reconnecting');
    //             try { websocket.disconnect() } catch (err) { };
    //             websocket.connect();
    //         }, 10 * 1000);
    //     }

    //     if (data.type === 'subscriptions') {
    //         console.log('subscriptions:', data);
    //     }

    //     if (data.type === 'snapshot') {

    //     }

    //     if (data.type === 'l2update' || data.type === 'ticker' || data.type === 'snapshot') {
    //         fs.appendFile('./logs/orderbooks/' + [data.product_id, data.type, tmstmp].join('_') + '.json', JSON.stringify(data) + '\n', (err) => {
    //             if (err) { console.log('error writing log files', err) }
    //         })
    //     }
    // });
    // websocket.on('error', err => {
    //     /* handle error */
    // });
    // websocket.on('close', () => {
    //     console.log('ERROR', 'Websocket Error', `websocket closed. Attempting to re-connect. id: ${websocket.id}`);

    //     // try to re-connect the first time...
    //     setTimeout(() => {
    //         websocket.connect();
    //     }, 3000)
    //     // let count = 1;
    //     // // attempt to re-connect every 30 seconds.
    //     // // TODO: maybe use an exponential backoff instead
    //     // const interval = setInterval(() => {
    //     //     if (!websocket.socket) {
    //     //         count++;

    //     //         // send me a email if it keeps failing every 30/2 = 15 minutes
    //     //         if (count % 30 === 0) {
    //     //             const time_since = 30 * count;
    //     //             console.log('CRIT', 'Websocket Error', `Attempting to re-connect for ${count} times. It has been ${time_since} seconds since we lost connection.`);
    //     //         }
    //     //         websocket.connect();
    //     //     }
    //     //     else {
    //     //         clearInterval(interval);
    //     //     }
    //     // }, 30000);
    // });

    // let count = 0;
    // setInterval(() => {
    //     console.log(count++);
    // }, 1000)

    // setInterval(() => {
    //     console.log('Initiating scheduled reconnection');
    //     websocket.disconnect();
    // }, 10 * 1000);


    // let coinbasepro = new ccxt.coinbasepro({
    //     apiKey: coinbasepro_credential.apikey,
    //     secret: coinbasepro_credential.base64secret,
    //     password: coinbasepro_credential.passphrase
    // });
    // console.log(coinbasepro.has)
    // console.log(coinbasepro.id, await coinbasepro.fetchOrders());
    // await coinbasepro.createOrder('ETH/GBP', 'limit', 'buy', 0.1, 50);
    // console.log(coinbasepro.id, await coinbasepro.fetchClosedOrders());
    // console.log(coinbasepro.id, await coinbasepro.fetchOpenOrders());
    // let coinbasepro_markets = await coinbasepro.loadMarkets();
    // console.log(coinbasepro_markets['BTC/GBP']);
    // console.log(coinbasepro.id, await coinbasepro.fetchMarkets());
    // const market_info = await coinbasepro.loadMarkets();
    // fs.writeFileSync('./logs/market_' + '2020-08-16' + '.json', JSON.stringify(market_info));
    // console.log(coinbasepro.id, await coinbasepro.privateGetPaymentMethods());

    //POST /profiles/transfer - to test

    // console.log(new ccxt.coinbasepro())
    // console.log(new ccxt.binance());
    // let binance = new ccxt.binance({
    //     apiKey: binance_credential.apiKey,
    //     secret: binance_credential.secretKey,
    // });
    // console.log(await binance.public_post_userdatastream());
    // console.log(await coinbasepro.fetchTicker('BTC/GBP'))
    // console.log(coinbasepro.requiredCredentials);
    // console.log(coinbasepro.id, await coinbasepro.fetchAccounts());

    // console.log(coinbasepro.id, await coinbasepro.fetchBalance());
    // fs.writeFileSync('./logs/balance_' + '2020-08-16' + '.json', JSON.stringify(await coinbasepro.fetchBalance()));

    /* === checks for a specific account, the transfer history requiring pagination === */
    // let after = ''
    // let allLedger = []
    // while (true) {

    //     const limit = 100 // change for your limit
    //     const params = { id: config.coinbase_dca_account_id, after, limit }
    //     const trades = await coinbasepro.privateGetAccountsIdLedger(params)
    //     if (trades.length) {
    //         // console.log(coinbasepro.last_response_headers);
    //         after = coinbasepro.last_response_headers['Cb-After'];
    //         allLedger.push(...trades)
    //     } else {
    //         break
    //     }
    //     console.log(`after: ${after} `)
    // }
    // console.log('all trades length', allLedger.length);
    // allLedger.forEach(element => {
    //     // console.log(element);
    //     if (element.type === 'transfer') {
    //         console.log(element.created_at, element.amount);
    //     }
    // });

})();