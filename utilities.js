const nodemailer = require('nodemailer');

const config = require('./config/config');

const transporter = nodemailer.createTransport(config.arbitorCoinNodeMailerCred);

const from = config.arbitorCoinNodeMailerCred.auth.user;
const to = config.nodemailRecipients;

// const send_mail = (type, msg, filename) => {
//     let mailOptions = { from, to };

//     switch (type) {
//         case 'aoc':
//             mailOptions.subject = 'DCA summary';
//             mailOptions.text = msg;
//             mailOptions.attachments = [
//                 {
//                     filename, path: './reports/' + filename,
//                 },
//             ]
//             break;

//         case 'routine_notify':
//             mailOptions.subject = 'DCA bot routine report';
//             mailOptions.text = msg;
//             mailOptions.attachments = [];
//             break;

//         default:
//             break;
//     }

//     transporter.sendMail(mailOptions, (error, info) => {
//         if (error) {
//             console.log(error);
//         } else {
//             console.log('Email sent: ' + info.response);
//         }
//     });
// }

// const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const OAuth2 = google.auth.OAuth2;

const createTransporter = async () => {
    const oauth2Client = new OAuth2(
        config.arbitorCoinNodeMailerCred.CLIENT_ID,
        config.arbitorCoinNodeMailerCred.CLIENT_SECRET,
        "https://developers.google.com/oauthplayground"
    );

    oauth2Client.setCredentials({
        refresh_token: config.arbitorCoinNodeMailerCred.REFRESH_TOKEN
    });

    const accessToken = await new Promise((resolve, reject) => {
        oauth2Client.getAccessToken((err, token) => {
            if (err) {
                reject();
            }
            resolve(token);
        });
    });

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            type: "OAuth2",
            user: config.arbitorCoinNodeMailerCred.EMAIL,
            accessToken,
            clientId: config.arbitorCoinNodeMailerCred.CLIENT_ID,
            clientSecret: config.arbitorCoinNodeMailerCred.CLIENT_SECRET,
            refreshToken: config.arbitorCoinNodeMailerCred.REFRESH_TOKEN
        }
    });

    return transporter;
};

//emailOptions - who sends what to whom
const send_email = async (emailOptions) => {
    let emailTransporter = await createTransporter();
    await emailTransporter.sendMail(emailOptions);
};


async function wait(ms) {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

module.exports = {
    wait, send_mail
};