# Fixture for card a4ae5970: a sender one directory down, reached by a `cd`. Never executed.
import smtplib

smtplib.SMTP('localhost').sendmail('a@example.com', ['b@example.com'], 'hello')
