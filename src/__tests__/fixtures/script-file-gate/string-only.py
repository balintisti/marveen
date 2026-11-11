# Fixture for card a4ae5970: a patch script whose send word stands only in a string
# literal (the bc98d6d5 shape). Not a send. Never executed.
T = "await mail.sendEmail({ html: '<b>x</b>' })"
print(len(T))
