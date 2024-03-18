For starters, try editing index.html and app.js to create some behaviors. app.js needs to be rebuilt whenever it is edited.


app.js/.jsx/.ts can be used as the main include point for everything else in the app to keep bundler settings simple. 

This is then simply included in index.html as the built dist/app.js file, which is compiled into commonjs by esbuild for us.

You will need to learn about and adjust the bundler.js and server.js if your needs are more complex. But this will get you started.

