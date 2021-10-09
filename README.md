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

-----

## DEVELOPER REFERENCES:

Firebase Cloud Functions:
- https://firebase.google.com/docs/functions

Firebase Cloud Functions with Typescript:
- https://firebase.google.com/docs/functions/typescript

Xero API:
- https://developer.xero.com/documentation/api/accounting/overview/

Xero AuthFlow:
- https://developer.xero.com/documentation/guides/oauth2/auth-flow#xero-tenants

Xero BankTransactions API:
- https://developer.xero.com/documentation/api/accounting/banktransactions

Firebase Environment Configuration:
- https://firebase.google.com/docs/functions/config-env

Learn Typescript Youtube:
- https://www.youtube.com/watch?v=BwuLxPH8IDs

Cloud Functions Google Console Invoker Permission:
- https://cloud.google.com/functions/docs/securing/authenticating#authenticating_function_to_function_calls

Notes:
- Multer does not work with Firebase Cloud Functions (https://mikesukmanowsky.com/firebase-file-and-image-uploads/)
