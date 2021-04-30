# Abbyy Cloud OCR client

This project implements a NodeJS client for the Abbyy Cloud OCR service. It builds on the JavaScript client provided
here: https://github.com/abbyy/ocrsdk.com


## Installation

To use the library in your projects, simply `npm install @cboulanger/abbyy-cloud-ocr`. See [the test script](run.ts) 
for an example on how to use the API.

## Testing

```bash
git clone https://github.com/cboulanger/cboulanger/abbyy-cloud-ocr.git
cd cboulanger/abbyy-cloud-ocr
cp .env.dist ./.env
# edit .env and provide the values needed there
npm install
npm test
```

## Creating an executable

You can create a standalone executable file which can be run on the command line by executing `npm run pkg`. The
executables for Linux/Windows/MacOS will be written to the `bin` directory.

> Please note that if you have set environment variables in a `.env` file, the package 
> include them and will be visible as plain text in the source! Please remove the file if you intend 
> to distribute the built executable. The values will be used as defaults, which is convenient for 
> personal use of the executable. 

The usage of the executable is

```bash
abbyy-cloud-ocr file1 file2 file3 
```

Note that if you don't compile in your `.env` file, you need to set the environment variables defined therein
before calling the executable. 
