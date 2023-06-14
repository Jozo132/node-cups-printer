// @ts-check
"use strict"

// This is a printer-driver for Node.JS that uses CUPS to print files.
// It is an alternative to the "node-printer" package.
// This driver is based on raw CUPS commands and does not require any additional packages or compilation.

const { spawn, spawnSync } = require('child_process')
const stream = require('stream')


/**
 * @param { string } command 
 * @param  {...string} args 
 * @returns { Promise<string> }
 */
const runCommand = (command, ...args) => new Promise((resolve, reject) => {
    const e_msg = `Failed to run command '${command} ${args.join(' ')}'`
    try {
        const child = spawn(command, args)
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', data => stdout += data)
        child.stderr.on('data', data => stderr += data)
        child.on('close', code => {
            if (code === 0) resolve(stdout)
            else reject(e_msg + ' - ' + stderr)
        })
    } catch (err) {
        reject(e_msg + ' - ' + err)
    }
})
/**
 * @param { string } command 
 * @param  {...string} args 
 * @returns { string }
 */
const runCommandSync = (command, ...args) => {
    const child = spawnSync(command, args)
    const stdout = (child.stdout || '').toString()
    const stderr = (child.stderr || '').toString()
    if (child.status === 0) return stdout
    const msg = `Failed to run command '${command} ${args.join(' ')}' - ${stderr || (`Unknown error code '${child.status}'`)}`
    throw new Error(msg)
}


/**
 * @param { string } command 
 * @param { string | Buffer } input 
 * @param  {...string} args 
 * @returns { Promise<string> }
 */
const runCommandPipe = (command, input, ...args) => new Promise((resolve, reject) => {
    const e_msg = `Failed to run command '${command} ${args.join(' ')}'`
    try {
        const child = spawn(command, args)
        const stdinStream = new stream.Readable()
        if (Buffer.isBuffer(input)) stdinStream.push(input, 'binary')
        else stdinStream.push(input)
        stdinStream.push(null)
        stdinStream.pipe(child.stdin)
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', data => stdout += data)
        child.stderr.on('data', data => stderr += data)
        child.on('close', code => {
            if (code === 0) resolve(stdout)
            else reject(e_msg + ' - ' + stderr)
        })
    } catch (err) {
        reject(e_msg + ' - ' + err)
    }
})

/**
 * @typedef {{
 *   name: string
 *   isDefault: boolean
 *   options: { [key: string]: string }
 * }} PrinterDetails
*/

/**
 * @typedef {{
 *   data: string | Buffer
 *   printer?: string | undefined
 *   type?: 'RAW' | 'TEXT' | 'PDF' | 'JPEG' | 'POSTSCRIPT' | 'COMMAND' | 'AUTO' | undefined
 *   options?: { [key: string]: string } | undefined
 *   success?: PrintOnSuccessFunction | undefined
 *   error?: PrintOnErrorFunction | undefined
 * }} PrintDirectOptions
*/

/** @typedef { (jobId: string) => any } PrintOnSuccessFunction */
/** @typedef { (err: Error) => any } PrintOnErrorFunction */



/** 
 * @typedef {{
 *     printer: string
 *     type?: 'RAW' | 'TEXT' | 'PDF' | 'JPEG' | 'POSTSCRIPT' | 'COMMAND' | 'AUTO' | undefined
 *     data: string | Buffer
 *     file?: string | undefined
 *     host?: string | undefined
 *     port?: number | undefined
 *     username?: string | undefined
 *     encryption?: boolean | undefined
 *     title?: string | undefined
 *     quality?: 3 | 4 | 5 | '3' | '4' | '5' | undefined
 *     orientation?: 3 | 4 | 5 | 6 | '3' | '4' | '5' | '6' | undefined
 *     copies?: number | undefined
 *     args?: string[] | undefined
 * }} PrintOptions 
 */
const lp_print = (/**@type {PrintOptions}*/options) => new Promise((resolve, reject) => {
    const args = options.args || []
    const printer = options.printer
    const type = ((options.type || 'RAW') + '').toLowerCase() // [RAW, ...]
    const data = options.data
    const file = options.file
    const host = options.host ? [options.host, options.port ? options.port : ''].filter(Boolean).join(':') : ''
    const username = options.username
    const encryption = options.encryption || false
    const title = options.title
    const quality = options.quality
    const orientation = options.orientation
    const copies = options.copies

    if (!printer) throw new Error('No printer provided')
    if (!data && !file) throw new Error('No data or file provided')

    if (!file) args.push('-o', type)
    if (copies) args.push(`-n`, copies + '')
    if (printer) args.push(`-d`, printer)
    if (host) args.push(`-h`, host)
    if (username) args.push(`-U`, username)
    if (title) args.push(`-T`, title)
    if (quality) args.push(`-o`, `print-quality=${quality}`)
    if (orientation) args.push(`-o`, `orientation-requested=${orientation}`)
    if (encryption) args.push(`-E`)

    const callback = response => {
        const split = response.split(' ').filter(Boolean)
        const jobId = split.length > 3 ? split[split.length - 3] : response
        resolve(jobId)
    }

    if (file) {
        args.push('--', file)
        runCommand('lp', ...args).then(callback)
        return
    }

    if (data) {
        runCommandPipe('lp', data, ...args).then(callback)
        return
    }
    throw new Error('No data or file provided')
})

/** @param { PrintDirectOptions } options */
const printDirect = options => {
    const { data, printer, type, options: optionsObj, success, error } = options
    if (!error) throw new Error('No error callback provided')
    if (!success) return error(new Error('No success callback provided'))
    if (!data) return error(new Error('No data provided'))
    if (!printer) return error(new Error('No printer provided'))

    const args = []
    if (type) args.push(`-o`, type)
    if (optionsObj) {
        for (const key in optionsObj) {
            args.push(`-o`, `${key}=${optionsObj[key]}`)
        }
    }

    try {
        lp_print({ printer, data, args })
            .then(success)
            .catch(error)
    } catch (err) {
        error(err)
    }
}

/** @type { (input: string) => PrinterDetails[] } */
const extractPrinters = input => {
    const lines = input.split('\n')
    /** @type { PrinterDetails[] } */
    const result = []
    /** @type { PrinterDetails | null } */
    let currentPrinter = null
    for (const line of lines) {
        const words = line.split(' ')
        if (words[0] === 'printer') {
            currentPrinter = {
                name: words[1],
                isDefault: false,
                options: {}
            }
        }
        if (currentPrinter) result.push(currentPrinter)
    }
    return result
}

class Printer {
    constructor() {
        /** @type { PrinterDetails[] } */
        this.printers = []
        this.printersLoaded = false
        // setInterval(() => this.getPrinters(), 15000)
        this.refreshInterval = undefined
    }

    autoRefresh(interval) {
        if (this.refreshInterval) clearInterval(this.refreshInterval)
        this.refreshInterval = setInterval(() => this.getPrinters(), interval || 15000)
    }

    /** @returns { PrinterDetails[] } */
    getPrinters() {
        if (!this.printersLoaded) {
            const printers = runCommandSync(`lpstat`, `-p`, `-d`)
            this.printers = extractPrinters(printers)
            this.printersLoaded = true
            return this.printers
        }
        runCommand(`lpstat`, `-p`, `-d`).then(response => {
            this.printers = extractPrinters(response)
            this.printersLoaded = true
        })
        return this.printers
    }

    /** @param { string } printerName * @returns { PrinterDetails | undefined } */
    getPrinter(printerName) {
        if (!this.printersLoaded || !this.refreshInterval) this.getPrinters()
        return this.printers.find(p => p.name === printerName)
    }

    /** @param {PrintDirectOptions} options * @returns { void } */
    printDirect(options) {
        const { printer, error } = options
        if (!error) throw new Error('No error callback provided')
        if (!printer) return error(new Error('No printer provided'))
        const printerExists = this.getPrinter(printer)
        if (!printerExists) return error(new Error(`Printer "${printer}" not found`))
        printDirect(options)
    }

    /** @param {PrintOptions} options * @returns { Promise<string> } */
    print(options) {
        return new Promise((resolve, reject) => {
            const { printer } = options
            if (!printer) throw new Error(`Printer name is required`)
            const printerExists = this.getPrinter(printer)
            if (!printerExists) throw new Error(`Printer "${printer}" not found`)
            // echo '<ZPL>' | lp -o raw -d 'ZPL-PRINTER'
            lp_print(options) // response = "Print result: request id is ZPL-PRINTER-92 (0 file(s))"
                .then(resolve) // "ZPL-PRINTER-92"
                .catch(reject)
        })
    }
}

const printer = new Printer()

module.exports = printer