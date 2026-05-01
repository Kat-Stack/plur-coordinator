This project contains a handful of files.


The commands folder is all commands for the bot to be able to run

create_plur.js creates a new discord channel (the current vehicle for the plur) and sends a message
help.js tells you all the commands
join_plur.js lets you join another channel as a collective agent (you will get their messages in a feed, and can respond to them)
opt_in.js lets you become a "citizen" / "participant" within a plur
propose.js creates a message that must be voted on. If approved, it is sent to the global feed 
send_to.js lets you message a different plur if you have their channel id (even if youre not in the server) 
setup_global.js assigns a channel as the server-wide designated "global channel" for the global feed messages (this can be in the same channel as regular chatting or w/e nbd)







the main js files outside of that folder here are:

deploy-commands.js - updates the testing server's command list (only has to be used when new commands are created)
deploy-global.js - updates the command list globally (in all servers // on discord's end) (only must be used w new commands)
index.js - actually runs the bot



currently im running it using pm2 within a digital ocean droplet
