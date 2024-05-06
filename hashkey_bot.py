import hashlib
import hmac
import json
import time
import websocket
import logging
import threading
import requests
import datetime
import configparser
import pandas as pd
import os

config = configparser.ConfigParser()
configFilePath = r'./config/config_hashkey.cfg'
config.read(configFilePath)

trade_pairs = config['DEFAULT']['trade_pairs'].split(',')
dca_pairs = config['DEFAULT']['dca_pairs'].split(',')

df_file_path = "./reports/trade_data.csv"
if os.path.isfile(df_file_path):
    trades_df = pd.read_csv(df_file_path)
    print('Existing dataframe found and loaded')
else:
    columns = ['Strategy', 'Symbol', 'Buy_Time', 'Buy_ID', 'Buy_Qty', 'Buy_Price', 'Buy_Fee',
               'Buy_Total', 'Sell_Time', 'Sell_ID', 'Sell_Qty', 'Sell_Price', 'Sell_Fee', 'Sell_Total', 'P_L']
    trades_df = pd.DataFrame(columns=columns)
    print('No dataframe found, create new')
# trades_df.to_csv(df_file_path, index=False)


def set_interval(func, sec):
    def func_wrapper():
        set_interval(func, sec)
        func()
    t = threading.Timer(sec, func_wrapper)
    t.start()
    return t


class WebSocketClient:
    def __init__(self, user_key, user_secret, subed_topic=[], subed_symbols=[]):
        self.user_key = user_key
        self.user_secret = user_secret
        self.subed_topic = subed_topic
        self.subed_symbols = subed_symbols
        self.listen_key = None
        self._logger = logging.getLogger(__name__)
        self._ws = None
        self._ping_thread = None
        self.polled_price = {}
        self.ws_price = {}

    def generate_listen_key(self):
        params = {
            'timestamp': int(time.time() * 1000),
        }
        api_headers = {
            'X-HK-APIKEY': self.user_key,
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        }
        signature = self.create_hmac256_signature(
            secret_key=self.user_secret, params=params)
        params.update({
            'signature': signature,
        })
        response = requests.post(
            url=f"https://api-pro.hashkey.com/api/v1/userDataStream", headers=api_headers, data=params)
        data = response.json()
        if 'listenKey' in data:
            self.listen_key = data['listenKey']
            self._logger.info(f"Generated listen key: {self.listen_key}")
        else:
            raise Exception("Failed to generate listen key")

    def create_hmac256_signature(self, secret_key, params, data=""):
        for k, v in params.items():
            data = data + str(k) + "=" + str(v) + "&"
        signature = hmac.new(
            secret_key.encode(), data[:-1].encode(), digestmod=hashlib.sha256).hexdigest()
        return signature

    def create_new_order(self, params):

        api_headers = {
            'X-HK-APIKEY': self.user_key,
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        }
        signature = self.create_hmac256_signature(
            secret_key=self.user_secret, params=params)

        params.update({
            'signature': signature,
        })

        try:
            response = requests.post(
                url=f"https://api-pro.hashkey.com/api/v1/spot/order", headers=api_headers, data=params)

            res = response.json()
            return res
        except Exception as e:
            self._logger.error(
                f"Create new order error: {e} response received {response.text}")

    def cancel_all_buy_orders(self):
        params = {
            'side': "BUY",
            'timestamp': int(time.time() * 1000),
        }
        api_headers = {
            "accept": "application/json",
            'X-HK-APIKEY': self.user_key
        }
        signature = self.create_hmac256_signature(
            secret_key=self.user_secret, params=params)
        params.update({
            'signature': signature,
        })

        try:
            response = requests.delete(
                url=f"https://api-pro.hashkey.com/api/v1/spot/openOrders", headers=api_headers, data=params)

            res = response.json()
            return res
        except Exception as e:
            self._logger.error(
                f"Cancel buy orders error: {e} response received {response.text}")

    def _on_message(self, ws, message):
        current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")
        self._logger.info(f"{current_time} - Received message: {message}")

        data = json.loads(message)
        if "pong" in data:
            # Received a pong message from the server
            self._logger.info("Received pong message")

        # Handle the received market data here
        # Note Private WS does not provide public data, separate ws required

        # Handle the received private stream updates here
        if isinstance(data, list):
            global trades_df
            for order in data:
                if order["e"] == "executionReport" and order["S"] == "BUY" and order["o"] == "LIMIT" and order["X"] == "FILLED":
                    # log the buy limit order in the df
                    unix_timestamp_sec = int(order["E"]) / 1000
                    dt_object = datetime.datetime.fromtimestamp(
                        unix_timestamp_sec)
                    readable_time = dt_object.strftime('%Y-%m-%d %H:%M:%S')
                    new_trade = {
                        'Strategy': "Market Maker",
                        'Symbol': order["s"],
                        'Buy_Time': readable_time,
                        'Buy_ID': str(order["i"]),
                        'Buy_Qty': order["q"],
                        'Buy_Price': order["p"],
                        'Buy_Fee': order["n"],
                        'Buy_Total': order["Z"],
                    }
                    trades_df = trades_df.append(new_trade, ignore_index=True)
                    # update the df to file for each order notification
                    trades_df.to_csv(df_file_path, index=False)

                    # set up a limit sell order with profit margin
                    sell_price = round(
                        float(order['p']) * float(config['DEFAULT']['sell_limit_margin']))
                    params = {
                        "symbol": order['s'],
                        "price": sell_price,
                        "side": 'SELL',
                        "type": 'LIMIT',
                        "quantity": order['q'],
                        'timestamp': int(time.time() * 1000),
                        'newClientOrderId': str(order['i'])
                    }
                    self.create_new_order(params)

                if order["e"] == "executionReport" and order["S"] == "SELL" and order["o"] == "LIMIT" and order["X"] == "REJECTED":
                    self._logger.error(f"Previous sell order rejected")
                    # check for failed sell order, if it's because price is below bid, try to increase the sell limit price
                    sell_price = round(
                        float(order['p']) * float(config['DEFAULT']['sell_limit_margin']))
                    params = {
                        "symbol": order['s'],
                        "price": sell_price,
                        "side": 'SELL',
                        "type": 'LIMIT',
                        "quantity": order['q'],
                        'timestamp': int(time.time() * 1000),
                    }
                    self.create_new_order(params)

                if order["e"] == "executionReport" and order["S"] == "BUY" and order["o"] == "LIMIT" and order["X"] == "PARTIALLY_CANCELED":
                    # log the buy limit order in the df
                    unix_timestamp_sec = int(order["E"]) / 1000
                    dt_object = datetime.datetime.fromtimestamp(
                        unix_timestamp_sec)
                    readable_time = dt_object.strftime('%Y-%m-%d %H:%M:%S')
                    new_trade = {
                        'Strategy': "Market Maker",
                        'Symbol': order["s"],
                        'Buy_Time': readable_time,
                        # Use execution ID to track separately from completely filled orders
                        'Buy_ID': str(order["c"]),
                        'Buy_Qty': order["z"],
                        'Buy_Price': order["p"],
                        'Buy_Fee': order["n"],
                        'Buy_Total': order["Z"],
                    }
                    trades_df = trades_df.append(new_trade, ignore_index=True)
                    # update the df to file for each order notification
                    trades_df.to_csv(df_file_path, index=False)

                    # set up a limit sell order with profit margin for partially filled orders that are cancelled
                    sell_price = round(
                        float(order['p']) * float(config['DEFAULT']['sell_limit_margin']))
                    params = {
                        "symbol": order['s'],
                        "price": sell_price,
                        "side": 'SELL',
                        "type": 'LIMIT',
                        "quantity": order['z'],
                        'timestamp': int(time.time() * 1000),
                        # Use execution ID to track separately from completely filled orders
                        'newClientOrderId': str(order['c'])
                    }
                    self.create_new_order(params)

                if order["e"] == "executionReport" and order["S"] == "SELL" and order["o"] == "LIMIT" and order["X"] == "FILLED":
                    # log the sell limit order in the df
                    unix_timestamp_sec = int(order["E"]) / 1000
                    dt_object = datetime.datetime.fromtimestamp(
                        unix_timestamp_sec)
                    readable_time = dt_object.strftime('%Y-%m-%d %H:%M:%S')

                    # use client order ID to find the corresponding buy limit order
                    search_trade = trades_df[trades_df['Buy_ID'].astype(str) == str(
                        order['c'])]
                    if search_trade.empty:
                        print(
                            f"No matching buy trade ID '{order['c']}' found. Append to df.")
                        new_trade = {
                            'Sell_Time': readable_time,
                            'Sell_ID': str(order["c"]),
                            'Sell_Qty': order["q"],
                            'Sell_Price': order["p"],
                            'Sell_Fee': order["n"],
                            'Sell_Total': order["Z"]
                        }
                        trades_df = trades_df.append(
                            new_trade, ignore_index=True)
                        # update the df to file for each order notification
                        trades_df.to_csv(df_file_path, index=False)

                    else:
                        print(
                            f"Matching buy trade ID '{order['c']}' found. Update record.")
                        # Get the index of the first (and only) row
                        # there should only be one match however
                        row_index = search_trade.index[0]
                        trades_df.loc[row_index, ['Sell_Time', 'Sell_ID', 'Sell_Qty',
                                                  'Sell_Price', 'Sell_Fee', 'Sell_Total']
                                      ] = [readable_time, str(order["c"]), order["q"], order["p"], order["n"], order["Z"]]

                        # update the df to file for each order notification
                        trades_df.to_csv(df_file_path, index=False)

    def _on_error(self, ws, error):
        self._logger.error(f"WebSocket error: {error}")

    def _on_close(self, ws):
        self._logger.info("Connection closed")

    def _on_open(self, ws):
        self._logger.info("Subscribing to topics")
        for topic in self.subed_topic:
            for symbol in self.subed_symbols:
                sub = {
                    "symbol": symbol,
                    "topic": topic,
                    "event": "sub",
                    "params": {
                        "binary": False
                    },
                    "id": 1
                }
                ws.send(json.dumps(sub))
                self._logger.info(f"Send message: {sub}")

        # Start the ping thread after connecting
        self._start_ping_thread()

    def _start_ping_thread(self):
        def send_ping():
            while self._ws:
                ping_message = {
                    # Send a timestamp as the ping message
                    "ping": int(time.time() * 1000)
                }
                self._ws.send(json.dumps(ping_message))
                self._logger.info(f"Send ping message: {ping_message}")

                # cancel all buy limit orders
                self._logger.info(
                    f"Buy orders cancelled: {self.cancel_all_buy_orders()}")

                # create new buy limit orders
                self._get_polled_price()
                self._logger.info(f"Polled price: {self.polled_price}")

                for pair in trade_pairs:
                    buy_price = round(float(self.polled_price[pair]) *
                                      float(config['DEFAULT']['buy_limit_margin']))
                    params = {
                        "symbol": pair,
                        "price": buy_price,
                        "side": 'BUY',
                        "type": 'LIMIT',
                        "quantity": config['DEFAULT']['trade_' + pair + '_quantity'],
                        'timestamp': int(time.time() * 1000),
                    }
                    self._logger.info(
                        f"New buy limit orders created: {self.create_new_order(params)}")

                sleep_s = int(config['DEFAULT']['trade_interval_s'])

                # run scheduled dca buy market orders
                hour = datetime.datetime.now().hour   # the current hour
                minute = datetime.datetime.now().minute  # the current minute

                if hour == int(config['DEFAULT']['dca_hour']) and minute == int(config['DEFAULT']['dca_minute']):
                    for pair in dca_pairs:
                        amt = round(
                            float(config['DEFAULT']['dca_' + pair + '_amount']))
                        dca_params = {
                            "symbol": pair,
                            "side": 'BUY',
                            "type": 'market',
                            "quantity": amt,  # v1 api - quantity is amount for market buy
                            'timestamp': int(time.time() * 1000),
                        }
                        # execute market buy order for dca, assume sleep is 60s
                        self._logger.info(
                            f"New buy market orders created: {self.create_new_order(dca_params)}")

                time.sleep(sleep_s)

        self._ping_thread = threading.Thread(target=send_ping)
        self._ping_thread.daemon = True
        self._ping_thread.start()

    def _get_polled_price(self):
        url = "https://api-pro.hashkey.com/quote/v1/ticker/bookTicker"
        headers = {"accept": "application/json"}
        try:
            response = requests.get(url, headers=headers)
            # print(type(response), response.text)
            for pair in response.json():
                self.polled_price[pair['s']] = float(pair['b'])
        except Exception as e:
            self._logger.error(f"Get price error: {e}")

    def connect(self):
        if not self.listen_key:
            self.generate_listen_key()

        base_url = 'wss://stream-pro.hashkey.com'
        endpoint = f'api/v1/ws/{self.listen_key}'
        stream_url = f"{base_url}/{endpoint}"
        self._logger.info(f"Connecting to {stream_url}")

        self._ws = websocket.WebSocketApp(stream_url,
                                          on_message=self._on_message,
                                          on_error=self._on_error,
                                          on_close=self._on_close)
        self._ws.on_open = self._on_open

        self._ws.run_forever()


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)

    user_key = config['DEFAULT']['access']
    user_secret = config['DEFAULT']['secret']
    subed_topics = ["depth"]
    subed_symbols = ["BTCUSD", "BTCHKD"]

    client = WebSocketClient(user_key, user_secret,
                             subed_topics, subed_symbols)

    client.connect()
