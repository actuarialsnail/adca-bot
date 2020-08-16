const nodemailer = require('nodemailer');

const config = require('./config/config');

const transporter = nodemailer.createTransport(config.arbitorCoinNodeMailerCred);

const from = config.arbitorCoinNodeMailerCred.auth.user;
const to = config.nodemailRecipients;

const sendMail = (type, msg, filename) => {
    let mailOptions = { from, to };

    switch (type) {
        case 'aoc':

            break;

        default:
            break;
    }

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.log(error);
        } else {
            console.log('Email sent: ' + info.response);
        }
    });
}

async function wait(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

module.exports = {
    wait, sendMail
};