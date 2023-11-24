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

config = configparser.ConfigParser()
configFilePath = r'./config/config_hashkey.cfg'
config.read(configFilePath)


class WebSocketClient:
    def __init__(self, user_key, user_secret, subed_topic=[]):
        self.user_key = user_key
        self.user_secret = user_secret
        self.subed_topic = subed_topic
        self.listen_key = None
        self._logger = logging.getLogger(__name__)
        self._ws = None
        self._ping_thread = None

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

    def create_new_order(self, secret_key, params):

        api_headers = {
            'X-HK-APIKEY': user_key,
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        }
        signature = self.create_hmac256_signature(
            secret_key=user_secret, params=params)

        params.update({
            'signature': signature,
        })

        response = requests.post(
            url=f"https://api-pro.hashkey.com/api/v1/spot/order", headers=api_headers, data=params)
        res = response.json()

        return res

    def _on_message(self, ws, message):
        current_time = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")
        self._logger.info(f"{current_time} - Received message: {message}")

        data = json.loads(message)
        if "pong" in data:
            # Received a pong message from the server
            self._logger.info("Received pong message")

        # Handle the received market data here

        if isinstance(data, list):
            for order in data:
                if order["e"] == "executionReport" and order["S"] == "BUY" and order["o"] == "LIMIT" and order["X"] == "FILLED":
                    # set up a limit sell order with profit margin
                    sell_price = float(order['p']) * 1.01
                    params = {
                        "symbol": order['s'],
                        "price": sell_price,
                        "side": 'SELL',
                        "type": 'LIMIT',
                        "quantity": order['q'],
                        'timestamp': int(time.time() * 1000),
                    }

                    self.create_new_order(self.user_secret, params)

    def _on_error(self, ws, error):
        self._logger.error(f"WebSocket error: {error}")

    def _on_close(self, ws):
        self._logger.info("Connection closed")

    def _on_open(self, ws):
        self._logger.info("Subscribing to topics")
        for topic in self.subed_topic:
            sub = {
                "symbol": "BTCUSD",
                "topic": topic,
                "event": "sub",
                "params": {
                    "limit": "100",
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

                # create new buy limit orders

                time.sleep(5)

        self._ping_thread = threading.Thread(target=send_ping)
        self._ping_thread.daemon = True
        self._ping_thread.start()

    def unsubscribe(self):
        if self._ws:
            self._logger.info("Unsubscribing from topics")
            for topic in self.subed_topic:
                unsub = {
                    "symbol": "BTCUSD",
                    "topic": topic,
                    "event": "cancel_all",
                    "params": {
                        # "limit": "100",
                        "binary": False
                    },
                    "id": 1
                }
                self._ws.send(json.dumps(unsub))

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
    subed_topics = ["trade"]

    client = WebSocketClient(user_key, user_secret, subed_topics)
    client.connect()
