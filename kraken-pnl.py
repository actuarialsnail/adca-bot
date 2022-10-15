import time
import os
import requests
import json

import configparser

import urllib.parse
import hashlib
import hmac
import base64

def get_kraken_signature(urlpath, data, secret):

    postdata = urllib.parse.urlencode(data)
    encoded = (str(data['nonce']) + postdata).encode()
    message = urlpath.encode() + hashlib.sha256(encoded).digest()

    mac = hmac.new(base64.b64decode(secret), message, hashlib.sha512)
    sigdigest = base64.b64encode(mac.digest())
    return sigdigest.decode()


config = configparser.ConfigParser()
configFilePath = r'./config/config_kraken.cfg'
config.read(configFilePath)

# Read Kraken API key and secret stored in environment variables
api_url = "https://api.kraken.com"
api_key = config['DEFAULT']['api']
api_sec = config['DEFAULT']['private_key']

# Attaches auth headers and returns results of a POST request
def kraken_request(uri_path, data, api_key, api_sec):
    headers = {}
    headers['API-Key'] = api_key
    # get_kraken_signature() as defined in the 'Authentication' section
    headers['API-Sign'] = get_kraken_signature(uri_path, data, api_sec)
    req = requests.post((api_url + uri_path), headers=headers, data=data)
    return req

####################
# Request for report
####################

resp = kraken_request('/0/private/AddExport', {
    "nonce": str(int(1000*time.time())),
    "description":"my_trades_1",
    "format":"CSV",
    "report":"trades",
    "starttm": 1634199845,
}, api_key, api_sec)

print(resp.json())

id = resp.json()['result']['id']
print(id)

############################
# Wait for report to finish, download and delete
############################

time.sleep(10)

i = 1
while i <= 100:

    resp = kraken_request('/0/private/ExportStatus', {
        "nonce": str(int(1000*time.time())),
        "report": "trades"
    }, api_key, api_sec)

    print(resp.json())

    if resp.json()['result'] == []:
        print('result empty')
    else:
        print('report generated')
        print(i)
        i = 100

    i += 1
    time.sleep(10)

# Download report and save it

resp = kraken_request('/0/private/RetrieveExport', {
    "nonce": str(int(1000*time.time())),
    "id": id
}, api_key, api_sec)

# Write export to a new file 'myexport.zip'
target_path = '/reports/myexport.zip'
handle = open(target_path, "wb")
for chunk in resp.iter_content(chunk_size=512):
    if chunk:  # filter out keep-alive new chunks
        handle.write(chunk)
handle.close()

# Delete report?
resp = kraken_request('/0/private/RemoveExport', {
    "nonce": str(int(1000*time.time())),
    "id": id,
    "type":"delete"
}, api_key, api_sec)

print(resp.json())

#############
# Open Orders
#############

# Construct the request and print the result
resp = kraken_request('/0/private/OpenOrders', {
    "nonce": str(int(1000*time.time())),
    "docalcs": True
}, api_key, api_sec)

# print(resp.json())
with open('/reports/data.json', 'w') as f:
    json.dump(resp.json()['result']['open'], f)