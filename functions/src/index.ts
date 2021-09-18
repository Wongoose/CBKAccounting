// import "./config/csvFile";
import * as functions from "firebase-functions";
import * as Papa from "papaparse";
import Busboy = require("busboy");
import path = require("path");
import os = require("os");
import fs = require("fs");

exports.inputXeroApi = functions.https.onRequest((request, response) => {
  if (request.method !== "POST") {
    return response.status(405).end();
  }
  const busboy = new Busboy({ headers: request.headers });
  const tmpdir = os.tmpdir();

  console.log("Busboy init in functions!");
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
  });
  // Triggered once all uploaded files are processed by Busboy.
  // We still need to wait for the disk writes (saves) to complete.
  busboy.on("finish", async () => {
    await Promise.all(fileWrites);
    console.log("Busboy FINISH! Process saved files here");
    console.log(uploads["testData"]);

    const tempFilePath = uploads["testData"];
    // Function to read csv which returns a promise so you can do async / await.
    const readCSV = async (filePath: fs.PathOrFileDescriptor) => {
      const csvFile = fs.readFileSync(filePath);
      const csvData = csvFile.toString();
      return new Promise<void>((resolve, reject) => {
        try {
          Papa.parse((csvData), {
            header: true,
            complete: (results: any) => {
              console.log("Complete", results.data.length, "records.");
              resolve(results.data);
            },
          });
        } catch (err) {
          reject(err);
        }
      });
    };

    const convertToJson = async () => {
      const parsedData: any = await readCSV(tempFilePath);
      console.log("parsedData is index 0: \n" + parsedData);
      console.log(parsedData[0]);
      console.log("parsedData is index 1: \n" + parsedData);
      console.log(parsedData[1]);
    };

    convertToJson();

    for (const file in uploads) {
      fs.unlinkSync(uploads[file]);
    }
    response.status(204).send();
  });

  busboy.end(request.rawBody);
});
