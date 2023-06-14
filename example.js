// @ts-check
'use strict'

const printer = require('./vovk-cups-printer')

const main = async () => {
    const printers = printer.getPrinters()
    console.log('Printers:', printers)
}

main()
    .catch(console.error)
    .finally(() => process.exit(0))