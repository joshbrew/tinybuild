# Generate a trusted certificate

Borrowed from: https://github.com/RubenVermeulen/generate-trusted-ssl-certificate and https://medium.com/@saleemmalikraja/testing-service-workers-in-you-local-with-self-signed-certificate-angular-4f447c33d6fc

You need openssl, you can get it easily with chocolatey: `choco install openssl`

1. Copy openssl-custom.cnf from this directory to your application directory

2. Run the command `openssl req -newkey rsa:2048 -x509 -nodes -keyout server.key -new -out server.crt -config ./openssl-custom.cnf -sha256 -days 365`

3. Click on the server.crt and install it in the Trusted Certificate Authority folder.