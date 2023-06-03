/** 
 * Based off of https://github.com/bahmutov/cypress-email-results/
 */

const nodemailer = require('nodemailer')
const { stripIndent } = require('common-tags')
const ci = require('ci-info')
const humanizeDuration = require('humanize-duration')

// Load a configuration file from crr.config.js if the file exists
// otherwise use the default configuration
const loadConfig = () => {

    try {
        return require(process.cwd() + '/crr.config.js')
    } catch (e) {
        return {}
    }
}

const config = loadConfig()

console.log("config", config)

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

        if (process.env.PACKAGE_NAME) {
            return process.env.PACKAGE_NAME
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

    // https://emailregex.com/

    let regex = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/

    return regex.test(email)
}

function getEmailFrom(options) {

    if (options.emailFrom) {

        // If is not string throw error
        if (typeof options.emailFrom !== 'string') {
            throw new Error('Invalid emailFrom option: not a string')
        }

        // If is not valid email address throw error
        if (!isEmail(options.emailFrom)) {
            throw new Error('Invalid emailFrom option: not a valid email address')
        }

        return options.emailFrom
    }

    if (!process.env.EMAIL_FROM) {
        throw new Error('Missing required option emailFrom or environment variable: EMAIL_FROM')
    }

    // process.env.EMAIL_FROM must be a string and must be a valid email address
    if (typeof process.env.EMAIL_FROM !== 'string') {
        throw new Error('Invalid EMAIL_FROM environment variable: not a string')
    }

    if (!isEmail(process.env.EMAIL_FROM)) {
        throw new Error('Invalid EMAIL_FROM environment variable: not a valid email address')
    }

    return process.env.EMAIL_FROM
}

const initEmailSender = (options) => {

    const emailSender = options.transport || initSmtpTransport()

    if (!emailSender) {
        throw new Error('Could not initialize emailSender')
    }

    if (!emailSender.sendMail) {
        throw new Error('emailSender does not have sendMail')
    }

    return emailSender
}

function validateAndReturnEmail(emailInput) {

    let emailTo = []

    // If options.emailTo is a string, check if it is a valid email address and add it to emailTo array
    if (typeof emailInput === 'string') {

        if (!isEmail(emailInput)) {
            throw new Error('Not a valid email address')
        }

        emailTo.push(emailInput)
    }

    // If emails is an array, check if all elements are valid email addresses and add them to emailTo array
    if (Array.isArray(emailInput)) {

        emailInput.forEach(email => {

            if (!isEmail(email)) {
                throw new Error('Not a valid email address')
            }

            emailTo.push(email)
        })
    }

    return emailTo
}

function getEmailTo(options) {

    let emailTo = []

    // Check if options.emailTo is defined and add the email addresses to emailTo array
    if (options.emailTo) {
        emailTo.push(...validateAndReturnEmail(options.emailTo))
    }

    // Check if process.env.EMAIL_TO is defined and add the email addresses to emailTo array
    if (process.env.EMAIL_TO) {
        emailTo.push(...validateAndReturnEmail(process.env.EMAIL_TO.split(',')))
    }

    if (emailTo.length === 0) {
        throw new Error('Missing required option emailTo or environment variable: EMAIL_TO')
    }

    // Remove duplicates
    emailTo = [...new Set(emailTo)]

    return emailTo
}

function registerCypressReportResults(on, config, options) {

    if (!options) {
        throw new Error('options is required')
    }
    
    if (!on) {
        throw new Error('Missing required option: on')
    }

    const emailFrom = getEmailFrom(options)

    let emailTo = getEmailTo(options)

    const emailSender = initEmailSender(options)

    const emailOnSuccess =
        'emailOnSuccess' in options ? options.emailOnSuccess : true

    const dryRun = 'dry' in options ? options.dry : false

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

        // If totals.failed > 0 add emails from process.env.EMAIL_ON_FAILURE to emailTo array
        if (totals.failed > 0 && process.env.EMAIL_TO_ON_FAILURE) {
            emailTo.push(...validateAndReturnEmail(process.env.EMAIL_TO_ON_FAILURE.split(',')))
        }

        if (totals.failed === 0) {

            // successful run
            if (!emailOnSuccess) {
                return
            }

            let hasRunToday = false

            if (process.env.LAST_RUN_DATE) {

                // oldDate is a string in ISO 8601 format
                // const inputDateTime = '2023-06-03T09:55:42Z'

                // get the current date
                const today = new Date()

                // if inputDateTime is not on the same date as today, then set result to false, otherwise true
                hasRunToday = process.env.LAST_RUN_DATE.substring(0, 10) === today.toISOString().substring(0, 10)
            }

            // If hasRunToday is true, then don't send email
            if (hasRunToday) {
                console.log('Cypress email results: already sent 100% success email today')
                return
            }
        }

        console.log(
            'Cypress email results: sending results to %d email users',
            emailTo.length,
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

        

        if (ci.isCI && ci.name) {
            text +=
                '\n\n\n' + `${ci.name} duration ${humanizeDuration(afterRun.totalDuration)}`
        }

        const emailOptions = {
            to: emailTo,
            from: emailFrom,
            subject,
            text,
        }

        // console.log(emailOptions.text)
        if (dryRun) {
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