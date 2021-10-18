// // NOT USED - INPUT CSV FILE
// exports.inputFile = functions.https.onRequest(async (request, response) => {
//     // inputXeroApi | this function should be called by WebHooks, parsing in the csvFile - POST

//     if (request.method !== "POST") {
//       response.status(405).send("You have sent an invalid response to this url. No action performed.");
//       return;
//     }

//     const { success, value, statusCode } = await validateBearerAuthToken(request, db);

//     if (!success) {
//       console.log(value);
//       response.status(statusCode ?? 403).send(value?.toString());
//       return;
//     }

//     const resultIP: ReturnValue = await validateIpAddress(request.ips[0], db);

//     if (!resultIP.success) {
//       console.log(resultIP.value);
//       response.status(resultIP.statusCode ?? 403).send(resultIP.value?.toString());
//       return;
//     }

//     const busboy = new Busboy({ headers: request.headers });
//     const tmpdir = os.tmpdir();
//     let global_field_name: string;

//     console.log("Busboy init in functions!");
//     functions.logger.info("Busboy init functions with tempDIR: " + tmpdir);
//     // This object will accumulate all the uploaded files, keyed by their name.
//     const uploads: any = {}; // Map<string, string>
//     const fileWrites: any[] = []; // Promise<void>[]
//     // This code will process each file uploaded.
//     busboy.on("file", (fieldname, file, filename) => {
//       // Note: os.tmpdir() points to an in-memory file system on GCF
//       // Thus, any files in it must fit in the instance"s memory.
//       console.log(`Processed file ${filename}`);
//       console.log(`Processed fieldName ${fieldname}`);
//       global_field_name = fieldname;

//       const filepath = path.join(tmpdir, filename);
//       console.log("File path is: " + filepath);
//       functions.logger.info("Filepath is: " + filepath);
//       uploads[fieldname] = filepath;

//       const writeStream = fs.createWriteStream(filepath);
//       file.pipe(writeStream);

//       // File was processed by Busboy; wait for it to be written.
//       // Note: GCF may not persist saved files across invocations.
//       // Persistent files must be kept in other locations
//       // (such as Cloud Storage buckets).
//       const promise = new Promise((resolve, reject) => {
//         file.on("end", () => {
//           console.log("writeStream end fileName: " + filename);
//           console.log("writeStream end file: " + file);
//           writeStream.end();
//         });
//         console.log("writeStream finish");
//         writeStream.on("finish", resolve);
//         writeStream.on("error", reject);
//       });
//       fileWrites.push(promise);
//       console.log("fileWrites DONE push");
//     });
//     // Triggered once all uploaded files are processed by Busboy.
//     // We still need to wait for the disk writes (saves) to complete.
//     busboy.on("finish", async () => {
//       await Promise.all(fileWrites);
//       console.log("Busboy FINISH! Process saved files here");
//       console.log("Uploads is: " + uploads);
//       console.log(uploads[global_field_name]);

//       const tempFilePath = uploads[global_field_name];


//       // convert to JSON
//       const listOfTransactions: Record<string, string>[] = await readCSV(tempFilePath);
//       const listOfFormattedTransactions: XeroTransactionObject[] = [];

//       for (const transaction of listOfTransactions) {
//         console.log("Transaction name: " + transaction["Description"]);
//         if (transaction["Description"] == undefined) {
//           // empty transaction line - IGNORE
//         } else {
//           const xeroTransactionObject: XeroTransactionObject = {
//             "Type": transaction["Type"],
//             "Reference": transaction["Reference"],
//             "Date": transaction["Date"],
//             "CurrencyCode": transaction["CurrencyCode"],
//             "Contact": {
//               "Name": transaction["Description"],
//               "EmailAddress": transaction["Email"],
//               "Phones": [
//                 {
//                   "PhoneType": "MOBILE",
//                   "PhoneNumber": transaction["ContactNumber"],
//                 },
//               ],
//               "BankAccountDetails": transaction["TransactionId"],
//             },
//             "LineItems": [
//               {
//                 "Description": transaction["Reference"],
//                 "Quantity": 1.0,
//                 "UnitAmount": transaction["Amount"],
//                 "AccountCode": transaction["AccountCode"],

//               },
//             ],
//             "BankAccount": {
//               "Code": transaction["BankCode"],
//             },
//           };

//           listOfFormattedTransactions.push(xeroTransactionObject);
//         }
//       }

//       console.log("Length of list of Formatted Transactions: " + listOfFormattedTransactions.length);

//       if (listOfFormattedTransactions.length == 0) {
//         response.status(400).send("INVALID INPUT DATA: Your CSV File does not have any valid transactions. No action was performed.");
//         return;
//       }
//       // final JSON to parse to XeroApi
//       const compiledXeroJson = {
//         "bankTransactions": listOfFormattedTransactions,
//       };

//       const resultOTP = await generateFirebaseOTP(db);

//       const NEW_FUNCTION_AUTH_URL = FUNCTION_AUTH_URL + "?code=" + resultOTP;

//       const { statusCode } = await xeroCreateBankTransaction(db, listOfFormattedTransactions);

//       switch (statusCode) {
//         case 200:
//           console.log("Update transactions successful");
//           response.status(200).send("UPDATE TRANSACTIONS TO XERO ACCOUNTING SUCCESSFUL!\n\nReference data that you'd uploaded: \n\n" + JSON.stringify(compiledXeroJson));
//           break;

//         case 401: {
//           const refreshSuccess = await xeroRefreshAccessToken(db);
//           if (!refreshSuccess) {
//             console.log("xeroRefreshAccessToken | Failed");
//             response.status(401).send("You are not authorized.");
//           } else {
//             const retryResult = await xeroCreateBankTransaction(db, listOfFormattedTransactions);
//             const retryStatusCode = retryResult.statusCode;
//             if (retryStatusCode !== 200) {
//               console.log("Retry xeroCreateBankTransactions | Failed with statusCode " + retryStatusCode);
//               if (retryStatusCode === 403) {
//                 response.status(403).send("This app is unauthorized or the auth has been resetted. Please manually authorize this app to connect with your xero organization here: \n" + NEW_FUNCTION_AUTH_URL);
//               } else {
//                 response.status(500).send("Your function call has been terminated, please try again.");
//               }
//             } else {
//               console.log("Update transactions successful");
//               response.status(200).send("UPDATE TRANSACTIONS TO XERO ACCOUNTING SUCCESSFUL!\n\nReference data that you'd uploaded: \n\n" + JSON.stringify(compiledXeroJson));
//             }
//           }
//           break;
//         }

//         case 403:
//           console.log("xeroCreateBankTransactions | Unauthorized with organization. Need manual Authentication.");
//           response.status(403).send("This app is unauthorized or the auth has been resetted. Please manually authorize this app to connect with your xero organization here: \n" + NEW_FUNCTION_AUTH_URL);
//           break;

//         default:
//           console.log("xeroCreateBankTransactions | Failed functions catch with statusCode: " + statusCode);
//           response.status(500).send("POSSIBLE INVALID CSV FORMAT: No data has been processed for this endpoint. This endpoint is expecting BankTransaction data to be specifed in the request body. Please check your CSV file and try again.");
//       }

//       // const url = global_xeroCreateBankTransaction;

//       // const options = {
//       //   method: "POST",
//       //   path: url,
//       //   headers: {
//       //     "Content-Type": "application/json",
//       //   },
//       //   body: JSON.stringify(compiledXeroJson),
//       // };

//       // nodeRequest.post(url, options, function (err, response, body) {
//       //   console.log("error:", err);
//       //   console.log("statusCode:", response && response.statusCode);
//       //   console.log("body:", body);
//       // });


//       for (const file in uploads) {
//         fs.unlinkSync(uploads[file]);
//       }
//       console.log("END");
//     });

//     busboy.end(request.rawBody);
//     // END
//   });

//   // NOT USED
//   exports.xeroGetTenantConnections = functions.https.onRequest(async (request, response) => {

//     const { success, value, statusCode } = await validateBearerAuthToken(request, db);

//     if (!success) {
//       console.log(value);
//       response.status(statusCode ?? 403).send(value?.toString());
//       return;
//     }

//     const resultIP: ReturnValue = await validateIpAddress(request.ips[0], db);

//     if (!resultIP.success) {
//       console.log(resultIP.value);
//       response.status(resultIP.statusCode ?? 403).send(resultIP.value?.toString());
//       return;
//     }

//     const cbkAccountingCollection = db.collection("CBKAccounting");
//     const doc = await cbkAccountingCollection.doc("tokens").get();
//     const dataMap = doc.data();

//     if (dataMap === undefined) throw Error("Access Token or Refresh Token not found");

//     const accessToken = dataMap["access_token"];

//     const getTenantConnectionsSuccess = await xeroGetTenantConnections(db, accessToken);

//     if (getTenantConnectionsSuccess) {
//       console.log("Cloud Function xeroGetTenantConnections | Success");
//       response.status(200).send("Xero Tenant ID updated successful.");
//     } else {
//       console.log("Cloud Function xeroGetTenantConnections | Failed");
//       response.status(500).send("Failed to update Xero Tenant ID, please try again.");

//     }
//   });

//   // NOT USED
//   exports.xeroRefreshToken = functions.https.onRequest(async (request, response) => {
//     console.log("\nCLOUD FUNCTION START OF xeroRefreshToken:\n");

//     console.log("xeroinputMain | RAN from request IP: " + request.ips[0]);

//     const { success, value, statusCode } = await validateBearerAuthToken(request, db);

//     if (!success) {
//       console.log(value);
//       response.status(statusCode ?? 403).send(value?.toString());
//       return;
//     }

//     const resultIP: ReturnValue = await validateIpAddress(request.ips[0], db);

//     if (!resultIP.success) {
//       console.log(resultIP.value);
//       response.status(resultIP.statusCode ?? 403).send(resultIP.value?.toString());
//       return;
//     }

//     // console.log("xeroinputMain | RAN from request headers x-forwarded-for: " + request.headers["x-forwarded-for"]);
//     // console.log("xeroinputMain | RAN from request socket.remoteAddress: " + request.socket.remoteAddress);
//     // console.log("xeroinputMain | RAN from request X-Forwarded-For: " + request.headers["X-Forwared-For"]);
//     // console.log("xeroinputMain | RAN from request connection: " + request.headers.connection);
//     // console.log("xeroinputMain | RAN from request IP: " + request.ip);
//     // console.log("xeroinputMain | RAN from request Origin: " + request.headers.origin);
//     // console.log("xeroinputMain | RAN from request IPs: " + request.ips);

//     const refreshSuccess = await xeroRefreshAccessToken(db);

//     if (refreshSuccess) {
//       console.log("Cloud Function xeroRefreshToken | Success");
//       response.status(200).send("Access Token and Refresh Token updated successful.");
//     } else {
//       console.log("Cloud Function xeroRefreshToken | Failed");
//       response.status(500).send("Failed to update Access Token and Refresh Token, please try again.");
//     }

//   });

//   // NOT USED
//   exports.xeroCreateBankTransaction = functions.https.onRequest(async (request, response) => {
//     const { success, value, statusCode } = await validateBearerAuthToken(request, db);

//     if (!success) {
//       console.log(value);
//       response.status(statusCode ?? 403).send(value?.toString());
//       return;
//     }

//     const resultIP: ReturnValue = await validateIpAddress(request.ips[0], db);

//     if (!resultIP.success) {
//       console.log(resultIP.value);
//       response.status(resultIP.statusCode ?? 403).send(resultIP.value?.toString());
//       return;
//     }

//     const result = await xeroCreateBankTransaction(db, request.body);
//     const status = result.statusCode;

//     if (status !== 200) {
//       console.log("Cloud Function xeroCreateBankTransaction | Failed");
//       response.status(500).send("Failed to create Bank Transaction in Xero");
//     } else {
//       response.status(200).send("SUCCESS! \n\nReference data you'd uploaded: \n\n" + JSON.stringify(request.body));
//     }
//   });
