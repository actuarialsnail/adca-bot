const nodemailer = require('nodemailer');

const config = require('./config/config');

const transporter = nodemailer.createTransport(config.arbitorCoinNodeMailerCred);

const from = config.arbitorCoinNodeMailerCred.auth.user;
const to = config.nodemailRecipients;

const send_mail = (type, msg, filename) => {
    let mailOptions = { from, to };

    switch (type) {
        case 'aoc':
            mailOptions.subject = 'DCA summary';
            mailOptions.text = msg;
            mailOptions.attachments = [
                {
                    filename, path: './reports/' + filename,
                },
            ]
            break;

        case 'routine_notify':
            mailOptions.subject = 'DCA bot routine report';
            mailOptions.text = msg;
            mailOptions.attachments = [];
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
    wait, send_mail
};