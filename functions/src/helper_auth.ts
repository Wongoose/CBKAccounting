import * as functions from "firebase-functions";
import admin = require("firebase-admin");

export const verifyUserFromCaller = async (request: functions.https.Request, response: functions.Response, auth:admin.auth.Auth):Promise<boolean> => {

  response.setHeader(
    "Access-Control-Allow-Headers",
    "append,delete,entries,foreach,get,has,keys,set,values,content-type,Authorization"
  );
  console.log(`Request headers origin is: ${request.headers.origin}`);

  if (
    request.headers.origin == "https://cbkreconciliation.web.app"
    // || request.headers.origin == "http://127.0.0.1:5500"
  ) {
    response.setHeader("Access-Control-Allow-Origin", request.headers.origin);
    // response.setHeader("Access-Control-Allow-Origin", "*");
  }
  response.setHeader(
    "Access-Control-Allow-Methods",
    "POST, GET, PUT, OPTIONS"
  );

  const token = request.headers.authorization?.split(" ")[1];
  console.log("fbToken | token is: " + token);

  if (token === undefined) {
    response.status(200).send({
      statusCode: 403,
      errorCode: "MISSING-TOKEN",
      message:
        "Could not find token in authorization header. Request rejected.",
    });

    return false;
  }

  const decodedIdToken = await auth.verifyIdToken(token, true);

  if (decodedIdToken === undefined) {
    response.status(200).send({
      statusCode: 403,
      errorCode: "INVALID-TOKEN",
      message: "Invalid token in authorization header. Request rejected.",
    });
    return false;
  }

  const user = await auth.getUser(decodedIdToken.uid);
  if (user.disabled) {
    response.status(200).send({
      statusCode: 403,
      errorCode: "DISABLED-USER",
      message: "This user is disabled. Request rejected.",
    });
    return false;
  }

  console.log(`Request made by user uid: ${user.uid}`);
  return true;
};
