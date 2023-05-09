# **CBKACCOUNTING DOCUMENTATION**

## **Objective:**

- To reformat the data received from webhooks, then creating bank transactions in the Xero Accounting Software

## **TWO MAIN FUNCTIONS**

### 1) XERO INPUT MAIN Function
- This is the main body function that processes inbound data, then attempting to create bank transactions in Xero 
- This should be the only function requested by WEBHOOKS while parsing in data
- URL: https://us-central1-cbkaccounting.cloudfunctions.net/xeroInputMain

### 2) XERO MANUAL AUTH Function
- This function must be called by the Xero Admininstrator user to manually authorize CBKAccounting's connection to their Xero organization
- This function is only needed for start-up deployment, and future redeployment if needed (called manually)
- URL: https://us-central1-cbkaccounting.cloudfunctions.net/xeroManualAuth

### IMPORTANT SECURITY MEASURES
- Function XERO INPUT MAIN will only run with a verified JSON Web Token in the request authorization header
- Function XERO MANUAL AUTH will only run with a verified OTP "?code=" query parameters

-----

## **HOW TO CREATE BANK TRANSACTIONS**

#### 1. Call a POST request to "XERO INPUT MAIN" Function (URL: https://us-central1-cbkaccounting.cloudfunctions.net/xeroInputMain)
#### 2. Requirements for your request header:
- **Authorization** - parse in the "Bearer YOUR_JWT"
- **Content-Type** - should be set to "application/json"

#### 3. Requirements for body:
- YOUR_TRANSACTION_DATA in JSON format

#### 4. Example request object:
`{
    headers: {
    "Authorization": "Bearer ey290s3m18283m237hss13",
    "Content-Type": "application/json"
},
body: {
    id: 001,
    email: test@example.com
}
}`

#### 5. Response:
- Function XERO INPUT MAIN will return the status code and the response body
- Statuscode 200 = SUCESS
- Any other statuscodes = FAIL
- Response body format:
`{
    error: "string",
    mesage: "string"
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
