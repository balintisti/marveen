# Fixture for card a4ae5970 (send-invocation-cases.json): a Python script that sends by
# running the mailer. Never executed; the gates only read it.
import subprocess

subprocess.run(['sendmail', '-t'], input=b'To: a@example.com\n\nhello\n', check=True)
