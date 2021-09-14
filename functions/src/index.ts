import * as functions from "firebase-functions";
// import { request, response } from "express";
// import * as express from "express";


// export const helloWorld = functions.https.onRequest((request, response) => {
//   functions.logger.info("Hello logs!", { structuredData: true });
//   response.send("Hello Mr CHong!");
// });

export const inputXeroApi = functions.https.onRequest((request, response) => {
  const {adminApiKey, adminEmail} = request.body;
  functions.logger.info("Api Key is: " + adminApiKey);
  functions.logger.info("Admin Email is: " + adminEmail);

  response.status(200).send("Successful!");
});
