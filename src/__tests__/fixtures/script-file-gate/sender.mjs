// Fixture for card a4ae5970: a Node script that sends. Never executed.
import nodemailer from 'nodemailer'

await nodemailer.createTransport({}).sendMail({ to: 'a@example.com', text: 'hello' })
