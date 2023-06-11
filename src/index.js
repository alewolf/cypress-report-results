/** 
 * Based off of https://github.com/bahmutov/cypress-email-results/
 */

const nodemailer = require('nodemailer')
const { stripIndent } = require('common-tags')
const ci = require('ci-info')
const humanizeDuration = require('humanize-duration')

const defaultOptions = {
    packageName: "",
    dry: false,
    email: {
        from: "",
        to: "",
        toOnFail: "",
        onSuccess: true,
        transport: null,
    },
}

let options

const getOptionsFromOptionsFile = () => {
    try {
        return require(process.cwd() + '/cypress-report-results.config.js');
    } catch (e) {
        throw new Error('Could not load config file')
    }
}

// Load a configuration file from cypress-report-results.config.js if the file exists
// otherwise use the default configuration
const loadOptions = () => {

    const customOptions = getOptionsFromOptionsFile();

    options = mergeOptions(defaultOptions, customOptions)

    // Make options.email.to an array if it is a string
    if (typeof options.email.to === 'string') {
        options.email.to = [options.email.to]
    }

    // Make options.email.toOnFail an array if it is a string
    if (typeof options.email.toOnFail === 'string') {
        options.email.toOnFail = [options.email.toOnFail]
    }

    validateOptions();
}


// defaultOptions and customOptions are nested objects
// go through it recursively
// if a key is missing in customOptions, use the key and value from defaultOptions
function mergeOptions(defaultOptions, customOptions) {

    // If customOptions is undefined, return defaultOptions
    if (!customOptions) {
        return defaultOptions
    }

    // If customOptions is not an object, throw error
    if (typeof customOptions !== 'object') {
        throw new Error('Invalid customOptions: not an object')
    }

    // If defaultOptions is not an object, throw error
    if (typeof defaultOptions !== 'object') {
        throw new Error('Invalid defaultOptions: not an object')
    }

    // If customOptions is an array, throw error
    if (Array.isArray(customOptions)) {
        throw new Error('Invalid customOptions: not an object')
    }

    // If defaultOptions is an array, throw error
    if (Array.isArray(defaultOptions)) {
        throw new Error('Invalid defaultOptions: not an object')
    }

    // If customOptions is an empty object, return defaultOptions
    if (Object.keys(customOptions).length === 0) {
        return defaultOptions
    }

    // If defaultOptions is an empty object, return customOptions
    if (Object.keys(defaultOptions).length === 0) {
        return customOptions
    }

    // If customOptions is an object and defaultOptions is an object, merge them
    const mergedOptions = {}

    // Loop through defaultOptions
    Object.keys(defaultOptions).forEach(key => {

        // If customOptions[key] is undefined, use defaultOptions[key]
        if (typeof customOptions[key] === 'undefined') {
            mergedOptions[key] = defaultOptions[key]
            return
        }

        // If customOptions[key] is an object and defaultOptions[key] is an object, merge them
        if (typeof customOptions[key] === 'object' && typeof defaultOptions[key] === 'object') {
            mergedOptions[key] = mergeOptions(defaultOptions[key], customOptions[key])
            return
        }

        // If customOptions[key] is not undefined, use customOptions[key]
        mergedOptions[key] = customOptions[key]
    })

    return mergedOptions
}

function validateOptions() {

    validateEmails(options.email.from, true)
    validateEmails(options.email.to)
    validateEmails(options.email.toOnFail, false, true)

    // packageName must be string
    if (typeof options.packageName !== 'string') {
        throw new Error('Invalid packageName option: not a string')
    }

    // email.onSuccess must be boolean
    if (typeof options.email.onSuccess !== 'boolean') {
        throw new Error('Invalid email.onSuccess option: not a boolean')
    }

    // dry must be boolean
    if (typeof options.dry !== 'boolean') {
        throw new Error('Invalid dry option: not a boolean')
    }
}

function validateEmails(emails, mustBeString = false, canBeEmpty = false) {

    // If options.email.to is empty and canBeEmpty is true, return
    if (canBeEmpty && emails === "") {
        return
    }

    // If mustBeString is true, check if emails is a string. If not, throw error
    if (mustBeString) {
        if (typeof emails !== 'string') {
            throw new Error('Invalid email option: not a string')
        }
    }

    // If options.email.to is a string, check if it is a valid email address. If yes, return
    if (typeof emails === 'string') {
        validateEmail(emails)
        return
    }

    // If emails is an array, check if all elements are valid email addresses. If yes, return
    if (Array.isArray(emails)) {

        if (emails.length === 0) {
            throw new Error('Missing required option email.to')
        }

        // Remove duplicates
        emails = [...new Set(emails)]

        emails.forEach(email => {
            validateEmail(email)
        })

        return
    }

    throw new Error(`Invalid email.to option: not a string or array: ${JSON.stringify(emails)}`)
}

const initSmtpTransport = () => {

    try {
        if (
            !process.env.SMTP_HOST
            || !process.env.SMTP_PORT
            || !process.env.SMTP_USER
            || !process.env.SMTP_PASSWORD
        ) {
            throw new Error(`Missing SMTP_ variables`)
        }

        const host = process.env.SMTP_HOST
        const port = Number(process.env.SMTP_PORT)
        const secure = port === 465
        const auth = {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
        }

        // create reusable transporter object using the default SMTP transport
        const transport = nodemailer.createTransport({
            host,
            port,
            secure,
            auth,
        })

        return transport

    } catch (e) {
        console.error(e)
        return false
    }
}

function dashes(s) {
    return '-'.repeat(s.length)
}

function getProjectName() {

    try {

        if (options.packageName) {
            return options.packageName
        }

        const pkg = require(process.cwd() + '/package.json')

        return pkg.name
    } catch (e) {
        return
    }
}

function getStatusEmoji(status) {

    // https://glebbahmutov.com/blog/cypress-test-statuses/
    const validStatuses = ['passed', 'failed', 'pending', 'skipped']
    if (!validStatuses.includes(status)) {
        throw new Error(`Invalid status: "${status}"`)
    }

    const emoji = {
        passed: '✅',
        failed: '❌',
        pending: '⌛',
        skipped: '⚠️',
    }
    return emoji[status]
}

function isEmail(email) {

    let regex = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/

    return regex.test(email)
}

const initEmailSender = () => {

    const emailSender = options.email.transport || initSmtpTransport()

    if (!emailSender) {
        throw new Error('Could not initialize emailSender')
    }

    if (!emailSender.sendMail) {
        throw new Error('emailSender does not have sendMail')
    }

    return emailSender
}

function validateEmail(email) {

    if (!isEmail(email)) {
        throw new Error(`Not a valid email address: "${email}"`)
    }
}

function customTrim(string) {
    // Remove any type of quotes and trim
    return string.replace(/['"]+/g, '').trim()
}

function registerCypressReportResults(on, config) {

    loadOptions()

    if (!on) {
        throw new Error('Missing required option: on')
    }

    const emailSender = initEmailSender()

    // keeps all test results by spec
    let allResults

    // `on` is used to hook into various events Cypress emits
    on('before:run', () => {
        allResults = {}
    })

    on('after:spec', (spec, results) => {
        allResults[spec.relative] = {}
        // shortcut
        const r = allResults[spec.relative]
        results.tests.forEach((t) => {
            const testTitle = t.title.join(' ')
            r[testTitle] = t.state
        })
    })

    on('after:run', async (afterRun) => {

        // console.log("afterRun", JSON.stringify(afterRun, null, 2))

        // Add the totals to the results
        // Explanation of test statuses in the blog post
        // https://glebbahmutov.com/blog/cypress-test-statuses/
        const totals = {
            suites: afterRun.totalSuites,
            tests: afterRun.totalTests,
            failed: afterRun.totalFailed,
            passed: afterRun.totalPassed,
            pending: afterRun.totalPending,
            skipped: afterRun.totalSkipped,
        }

        console.log(
            'Cypress email results: %d total tests, %d passes, %d failed, %d others',
            totals.tests,
            totals.passed,
            totals.failed,
            totals.pending + totals.skipped,
        )

        const runStatus = totals.failed > 0 ? 'FAILED' : 'OK'

        // If totals.failed > 0 add emails from options.email.toOnFail to email.to array
        if (totals.failed > 0 && options.email.toOnFail) {
            options.email.to.push(...options.email.toOnFail)
        }

        let hasRunToday = false

        if (totals.failed === 0) {

            // successful run
            if (!options.email.onSuccess) {
                return
            }

            // Find out what weekday it is. If it Saturday or Sunday, then don't send email
            // Only do this if NODE_ENV is not set to development
            if (
                !process.env.NODE_ENV
                || process.env.NODE_ENV !== 'development'
            ) {

                const day = new Date().getDay()

                if (day === 0 || day === 6) {
                    console.log('Cypress email results: not sending 100% success email on weekend')
                    return
                }
            }

            if (process.env.LAST_RUN_DATE) {

                // oldDate is a string in ISO 8601 format
                // const inputDateTime = '2023-06-03T09:55:42Z'

                // get the current date
                const today = new Date()

                // if inputDateTime is not on the same date as today, then set result to false, otherwise true
                hasRunToday = customTrim(process.env.LAST_RUN_DATE).substring(0, 10) === today.toISOString().substring(0, 10)
            }

            // If hasRunToday is true, then don't send email
            if (hasRunToday) {
                console.log('Cypress email results: already sent 100% success email today')
                return
            }
        }

        console.log(
            'Cypress email results: sending results to %d email users',
            options.email.to.length,
        )

        const n = Object.keys(allResults).length

        const textStart = stripIndent`
      ${totals.tests} total tests across ${n} test files.
      ${totals.passed} tests passed, ${totals.failed} failed, ${totals.pending} pending, ${totals.skipped} skipped.
    `
        const testResults = Object.keys(allResults)
            .map((spec) => {
                const specResults = allResults[spec]
                return (
                    spec +
                    '\n' +
                    dashes(spec) +
                    '\n' +
                    Object.keys(specResults)
                        .map((testName) => {
                            const testStatus = specResults[testName]
                            const testCharacter = getStatusEmoji(testStatus)
                            return `${testCharacter} ${testName}`
                        })
                        .join('\n')
                )
            })
            .join('\n\n')

        const name = getProjectName()

        const subject = name
            ? `${name} - Cypress tests ${runStatus}`
            : `Cypress tests ${runStatus}`

        const dashboard = afterRun.runUrl ? `Run url: ${afterRun.runUrl}\n` : ''

        let text = textStart + '\n\n' + dashboard + '\n\n' + testResults

        // Add process.env.LAST_RUN_DATE to text
        // if (process.env.LAST_RUN_DATE) {
        //     text += '\n\n\n' + `Last run date: ${process.env.LAST_RUN_DATE}`
        // }

        // Add hasRunToday to text
        // if (process.env.LAST_RUN_DATE) {
        //     text += '\n\n\n' + `Has run today: ${hasRunToday}`

        //     // add today's date to string
        //     const today = new Date()
        //     text += '\n\n\n' + `Today's date: ${today.toISOString().substring(0, 10)}`

        //     // add process.env.LAST_RUN_DATE date to string
        //     text += '\n\n\n' + `process.env.LAST_RUN_DATE: ${customTrim(process.env.LAST_RUN_DATE).substring(0, 10)}`
        // }

        if (ci.isCI && ci.name) {
            text +=
                '\n\n\n' + `${ci.name} duration ${humanizeDuration(afterRun.totalDuration)}`
        }

        const emailOptions = {
            from: options.email.from,
            to: options.email.to,
            subject,
            text,
        }

        // console.log(emailOptions.text)
        if (options.dry) {
            console.log('Cypress email results: dry run, not sending email')
            console.log('')
            console.log(subject)
            console.log('')
            console.log(emailOptions.text)
        } else {
            await emailSender.sendMail(emailOptions)
            console.log('Cypress results emailed')
        }
    })
}

// export registerCypressEmailResults
module.exports = registerCypressReportResults