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

/** @typedef { (jobId: number) => any } PrintOnSuccessFunction */
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
 * @returns { Promise<number> }
 */
const lp_print = (/**@type {PrintOptions}*/options) => new Promise((resolve, reject) => {
    try {
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

        /** @type { (response: string) => void } */
        const callback = response => {
            const split = response.split(' ').filter(Boolean)
            const jobIdLong = split.length > 3 ? split[split.length - 3] : response
            const jobId = +jobIdLong.split('-')[jobIdLong.split('-').length - 1]
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
    } catch (err) {
        reject(err)
    }
})

/** @type { (options: PrintDirectOptions) => void} */
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

/** @typedef {{ [key: string]: [string, string] | [string, string, string] }} LPSTAT_in */
/** @typedef {{ [key: string]: string }} LPSTAT_out */

/** @type { LPSTAT_in } */
const lpstat_commands = {
    printers: ['lpstat', '-p'], // Printers and their status
    accepting: ['lpstat', '-a'], // Printers accepting requests
    addresses: ['lpstat', '-s'], // Printers and their addresses
    default: ['lpstat', '-d'], // Default printer
    details: ['lpstat', '-l', '-p'], // Printer details
}

const lpstat_keys = Object.keys(lpstat_commands)


const lpstat_detail_ki = [
    { key: 'printer-info', filter: 'Description: ' },
    { key: 'printer-location', filter: 'Location: ' },
]

/** @type { (stats: LPSTAT_out) => PrinterDetails[] } */
const extractPrinters = stats => {
    const { accepting, default: defaultPrinter, addresses, printers, details } = stats
    const addressLines = addresses.split('\n')
    const acceptingLines = accepting.split('\n')
    const lines = printers.split('\n')
    const printerDetails = details.split('\nprinter').filter(Boolean)
    /** @type { PrinterDetails[] } */
    const result = []
    /** @type { PrinterDetails | null } */
    let currentPrinter = null
    for (const line of lines) {
        const words = line.split(' ')
        if (words[0] === 'printer') {
            const name = words[1]
            const isDefault = defaultPrinter.includes(name)
            const socket_line = addressLines.find(line => line.includes(name + ': '))
            const socket = socket_line ? socket_line.split(' ')[socket_line.split(' ').length - 1] : ''
            const acceptingRequests = !!acceptingLines.find(line => line.includes(name + ' accepting')) ? 'true' : 'false'
            const details = printerDetails.find(line => line.includes(name + ' '))
            const info = {}

            if (details) {
                const rows = details.split('\n').map(line => line.trim()).filter(Boolean)
                for (let i = 0; i < lpstat_detail_ki.length; i++) {
                    const { key, filter } = lpstat_detail_ki[i]
                    const row = rows.find(row => row.startsWith(filter))
                    if (row) {
                        info[key] = row.slice(filter.length).trim()
                    }
                }
            }

            /* // Actual printer details from the 'node-printer' package
                name: 'ZPL-printer-test',
                isDefault: false,
                options: {
                    copies: '1',
                    'device-uri': 'socket://192.168.1.40:9100',
                    finishings: '3',
                    'job-cancel-after': '10800',
                    'job-hold-until': 'no-hold',
                    'job-priority': '50',
                    'job-sheets': 'none,none',
                    'marker-change-time': 1970-01-01T00:00:00.000Z,
                    'number-up': '1',
                    'print-color-mode': 'monochrome',
                    'printer-commands': 'none',
                    'printer-info': 'Toshiba Label Printer (ZPL format)',
                    'printer-is-accepting-jobs': 'true',
                    'printer-is-shared': 'false',
                    'printer-is-temporary': 'false',
                    'printer-location': 'XT2',
                    'printer-make-and-model': 'TOSHIBA B-EX4T2-G',
                    'printer-state': '3',
                    'printer-state-change-time': 2023-06-09T11:37:35.000Z,
                    'printer-state-reasons': 'none',
                    'printer-type': '1234567',
                    'printer-uri-supported': 'ipp://localhost/printers/ZPL-printer-test'
                },
                status: 'IDLE'
            */
            currentPrinter = {
                name,
                isDefault,
                options: {
                    'printer-is-accepting-jobs': acceptingRequests,
                    'device-uri': socket,
                    ...info,
                }
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
        /** @type { LPSTAT_out } */
        const stats = {}
        if (!this.printersLoaded) {
            lpstat_keys.forEach(key => {
                const command = lpstat_commands[key] // @ts-ignore
                const response = runCommandSync(...command)
                stats[key] = response
            })
            // const printers = runCommandSync(`lpstat`, `-p`, `-d`)
            this.printers = extractPrinters(stats)
            this.printersLoaded = true
            return this.printers
        } // @ts-ignore
        Promise.all(lpstat_keys.map(key => runCommand(...lpstat_commands[key]))).then(responses => {
            /** @type { LPSTAT_out } */
            const stats = {}
            for (let i = 0; i < responses.length; i++) {
                const key = lpstat_keys[i]
                const response = responses[i]
                stats[key] = response
            }
            this.printers = extractPrinters(stats)
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

    /** @param {PrintOptions} options * @returns { Promise<number> } */
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