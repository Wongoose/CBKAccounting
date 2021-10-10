# **CBKACCOUNTING DOCUMENTATION**

## **Objective:**

- To reformat the data received from webhooks, then creating bank transactions in the Xero Accounting Software

## **THREE MAIN FUNCTIONS**

### 1) XERO INPUT MAIN Function
- This is the main body function that processes inbound data, then attempting to create bank transactions in Xero 
- This should be the only function requested by WEBHOOKS while parsing in data
- URL: https://us-central1-cbkaccounting.cloudfunctions.net/xeroInputMain

### 2) XERO REFRESH TOKEN Function
- This function is called to refresh the authorization for CBKAccounting by getting a new Access Token and Refresh Token from Xero API.
- This functions will be called automatically in the cloud functions when "xeroInputMain Function" failed with status "401: unauthorized client".
- URL: https://us-central1-cbkaccounting.cloudfunctions.net/xeroRefreshToken

### 3) XERO MANUAL AUTH Function
- This function must be called by the Xero Admininstrator user to manually authorize CBKAccounting's connection to their Xero organization
- This function is only needed for start-up deployment, and future redeployment if needed (called manually)
- URL: https://us-central1-cbkaccounting.cloudfunctions.net/xeroManualAuth

### IMPORTANT SECURITY MEASURES
- Function XERO INPUT MAIN and XERO REFRESH TOKEN will only run with the correct "Authorization" header and IP Address (whitelisted)
- Function XERO MANUAL AUTH will only run with the correct OTP "?code=" query parameters

-----

## **HOW TO CREATE BANK TRANSACTIONS**

#### 1. Call a POST request to "XERO INPUT MAIN" Function (URL: https://us-central1-cbkaccounting.cloudfunctions.net/xeroInputMain)
#### 2. Requirements for your request header:
- **Authorization** - parse in the "Bearer CHUMBAKA_SECRET_KEY"
- **Content-Type** - should be set to "multipart/form-data"

#### 3. Requirements for body:
- **Key** - FIELD_NAME
- **Value** - CSV_FILE (Must only be a file of .CSV format)

#### 4. Important notes:
- The CSV file must have a specific format as shown in the directory documentaion/tempate.csv
- You can find the CSV file template under the documentation folder
- You must only parse in 1 CSV file per request
- Your one CSV file can have multiple lines of transactions, each of them will be processed
- Further security measures will be implemented before production

#### 5. Example request object:
`{
    headers: {
    "Authorization": "Bearer 290s3m18283m237hss13",
    "Content-Type": "mulipart/form-data
},
form-data: {"2021-10-30-TransactionData": CURRENT_CSV_FILE}
}`