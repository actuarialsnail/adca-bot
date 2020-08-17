'use strict';
const config = require('./config/config.js');
const ccxt = require('ccxt');
// console.log(ccxt.exchanges);
const coinbasepro_credential = config.credential.coinbase_dca;
const fs = require('fs');

(async function () {

    let coinbasepro = new ccxt.coinbasepro({
        apiKey: coinbasepro_credential.apikey,
        secret: coinbasepro_credential.base64secret,
        password: coinbasepro_credential.passphrase
    });
    // let coinbasepro_markets = await coinbasepro.loadMarkets();
    // console.log(coinbasepro_markets['BTC/GBP']);
    // console.log(coinbasepro.id, await coinbasepro.fetchMarkets());
    // const market_info = await coinbasepro.loadMarkets();
    // fs.writeFileSync('./logs/market_' + '2020-08-16' + '.json', JSON.stringify(market_info));
    console.log(coinbasepro.id, coinbasepro.has);

    // console.log(new ccxt.coinbasepro())
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