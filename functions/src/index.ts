import * as functions from "firebase-functions";
import "./config/csvFile";
// import express = require("express");
import Busboy = require("busboy");
import path = require("path");
import os = require("os");
import fs = require("fs");

exports.inputXeroApi = functions.https.onRequest((request, response) => {
  if (request.method !== "POST") {
    // Return a "method not allowed" error
    return response.status(405).end();
  }
  const busboy = new Busboy({ headers: request.headers });
  const tmpdir = os.tmpdir();

  console.log("Busboy init in functions!");
  // // This object will accumulate all the fields, keyed by their name
  // const fields = {};
  // This object will accumulate all the uploaded files, keyed by their name.
  const uploads: any = {};
  const fileWrites: any[] = [];
  // This code will process each file uploaded.
  busboy.on("file", (fieldname, file, filename) => {
    // Note: os.tmpdir() points to an in-memory file system on GCF
    // Thus, any files in it must fit in the instance"s memory.
    console.log(`Processed file ${filename}`);
    const filepath = path.join(tmpdir, filename);
    uploads[fieldname] = filepath;

    const writeStream = fs.createWriteStream(filepath);
    file.pipe(writeStream);

    // File was processed by Busboy; wait for it to be written.
    // Note: GCF may not persist saved files across invocations.
    // Persistent files must be kept in other locations
    // (such as Cloud Storage buckets).
    const promise = new Promise((resolve, reject) => {
      file.on("end", () => {
        console.log("writeStream end fileName: " + filename);
        console.log("writeStream end file: " + file);
        writeStream.end();

      });
      console.log("writeStream finish");
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });
    fileWrites.push(promise);
    console.log("fileWrites DONE push");

    // console.log("Buffer File");
    // let buf = "";
    // file.on("data", function (d) {
    //   buf += d;
    // }).on("end", function () {
    //   const val = JSON.parse(buf);
    //   console.log("Buffered file is: " + val);
    //   // use `val` here ...
    // }).setEncoding("utf8");
  });
  // Triggered once all uploaded files are processed by Busboy.
  // We still need to wait for the disk writes (saves) to complete.
  busboy.on("finish", async () => {
    await Promise.all(fileWrites);
    console.log("Busboy FINISH! Process saved files here");
    console.log(uploads);
    // console.log("File: " +  );
    /**
     * TODO(developer): Process saved files here
     */
    for (const file in uploads) {
      fs.unlinkSync(uploads[file]);
    }
    response.status(204).send();
  });

  busboy.end(request.rawBody);
});
// const app = express();

// app.post("/", function (request, response) {

//   if (request.method !== "POST") {
//     // Return a "method not allowed" error
//     return response.status(405).end();
//   }
//   const busboy = new Busboy({ headers: request.headers });
//   const tmpdir = os.tmpdir();

//   // // This object will accumulate all the fields, keyed by their name
//   // const fields = {};

//   // This object will accumulate all the uploaded files, keyed by their name.
//   const uploads = {};

//   // This code will process each file uploaded.
//   busboy.on("file", (fieldname, file, filename) => {
//     // Note: os.tmpdir() points to an in-memory file system on GCF
//     // Thus, any files in it must fit in the instance"s memory.
//     console.log(`Processed file ${filename}`);
//     const filepath = path.join(tmpdir, filename);
//     uploads[fieldname] = filepath;

//     const writeStream = fs.createWriteStream(filepath);
//     file.pipe(writeStream);

//     // File was processed by Busboy; wait for it to be written.
//     // Note: GCF may not persist saved files across invocations.
//     // Persistent files must be kept in other locations
//     // (such as Cloud Storage buckets).
//     const promise = new Promise((resolve, reject) => {
//       file.on("end", () => {
//         writeStream.end();
//       });
//       writeStream.on("finish", resolve);
//       writeStream.on("error", reject);
//     });
//     fileWrites.push(promise);
//   });
// });

// app.post("/", upload.single("testData"), function (request, response) {
//   console.log(request.file);
//   console.log("Requested file is: \n\n" + request.file?.filename + "\n" + request.file);
//   response.status(204).send();

// });

// exports.inputXeroApi = functions.https.onRequest(app);


// export const inputXeroApi = functions.https.onRequest((request, response) => {
//   upload.single("testData.csv");
//   console.log("Requested file is: \n\n" + String(request.file?.filename) + String(request.file));
//   response.status(204).send();
//   // functions.logger.info("Admin Email is: " + adminEmail);

//   // response.status(200).send("Successful with: \n\n" + String(csvData));
// });
