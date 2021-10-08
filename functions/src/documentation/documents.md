CBKACCOUNTING CLOUD FUNCTIONS DOCUMENTATION

Objective:
- To reformat the data received from webhooks, then creating bank transactions in the Xero Accounting Software

Three Main Functions:
- inputXeroMain Function
1) This is the main body function that processes inbound data, then attempting to create bank transactions in Xero 
2) This should be the only function requested by WEBHOOKS while parsing in data
3) URL: https://us-central1-cbkaccounting.cloudfunctions.net/inputXeroMain

- xeroRefreshToken Function
1) This function is called to refresh the authorization for CBKAccounting by getting a new Access Token and Refresh Token from Xero API.
2) This functions will be called automatically in the cloud functions when "inputXeroMain Function" failed with status "401: unauthorized client".
3) URL: https://us-central1-cbkaccounting.cloudfunctions.net/xeroRefreshToken

- xeroManualAuth Function
1) This function must be called by the Xero Admininstrator user to manually authorize CBKAccounting's connection to their Xero organization
2) This function is only needed for start-up deployment, and future redeployment if needed (called manually)
3) URL: https://us-central1-cbkaccounting.cloudfunctions.net/xeroManualAuth



Must be .CSV file
Only parse in one CSV file per request
CSV file can have multiple lines of transactions

No requirements for Request Headers

Request requirements:
"Content-Type": "multipart/form-data"
Key: inputData, Value: inputData.csv
