// import { config } from "firebase-functions/v1";
import { readFile } from "fs";
// import * as Papa from "papaparse";


console.log("csvFile start");
readFile("../functions/src/assets/testData.csv", (err, data) => {
  if (err) return console.log(err);
  // console.log(data);

  // const papaParse = Papa.parse("https://firebasestorage.googleapis.com/v0/b/cbkaccounting.appspot.com/o/testData.csv?alt=media&token=e20635e5-c376-4ee7-b17a-1b8340a80aef", {
  //   download: true,
  //   // rest of config ...
  // }).data;

  // console.log("papaparse is: \n" + papaParse);
});
