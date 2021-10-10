// exports.createBankAccount = functions.https.onRequest(async (request, response) => {

//     let _access_token = "";
//     let _xeroTenantId = "";

//     let dataMap: any | undefined;

//     await cbkAccountingCollection.doc("tokens").get().then((doc) => {
//       dataMap = doc.data();

//       if (dataMap != null || dataMap != undefined) {
//         // there is data
//         _access_token = dataMap["access_token"];
//         _xeroTenantId = dataMap["xero-tenant-id"];
//       }
//     });

//     const url = "https://api.xero.com/api.xro/2.0/Accounts";
//     const bodyData = {
//       "Code": "200",
//       "Name": "Zheng Xiang Wong",
//       "Type": "BANK",
//       "BankAccountNumber": "101012041962",
//     };
//     const options = {
//       method: "PUT",
//       path: url,
//       headers: {
//         "Content-Type": "application/json",
//         "Authorization": "Bearer " + _access_token,
//         "Xero-Tenant-Id": _xeroTenantId,
//       },
//       body: JSON.stringify(bodyData),
//     };

//     nodeRequest.put(url, options, function (err, response, body) {
//       console.log("error:", err);
//       console.log("statusCode:", response && response.statusCode);
//       console.log("body:", body);
//       console.log("createBankAccount END");
//     });

//     response.status(200).send("Success");
//   });
