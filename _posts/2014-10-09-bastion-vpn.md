---
layout: post
title: "Bastion VPN"
date: 2014-10-09 18:41:00
comments: true
---

Today, I needed to allow remote VPN access to a network that is behind a firewall out of my control. I could not obtain port forwarding or a public IP address that a VPN client can easily get to. This is a common problem for home routers or networks behind a university campus NAT/firewall.

What I needed is a sort of rendezvous point between my VPN client and a VPN server on an internal network. Any sort of cloud instance with a public IP would fit the bill. Luckily, I have some free credit on [DigitalOcean](https://www.digitalocean.com/?refcode=ddac7aa191d7) (thanks to the [GitHub Student Developer Pack](https://education.github.com/pack)).

Now that I can get around the NAT problem, the next problem is to select a tunneling mechanism. There are many options out there, like IPsec, OpenVPN, and SSH, just to name a few. I wanted to use OpenVPN for the server-client side anyway, and it turns out I could easily leverage OpenVPN for both sides of the tunnel.

![Network topology](/images/bastion-vpn.png)

## Preparing a certificate authority

I will be using SSL/TLS mode on OpenVPN, which means I'll need to be able to generate signed certificates for clients and servers to authenticate each other with. On my local machine, I generated a private key and generated a self-signed certificate for my very own certificate authority.

```bash
openssl genrsa -aes256 -out ca.key 2048
openssl req -x509 -new -nodes -key ca.key -days 730 -out ca.crt
echo 01 > ca.srl
```

After this, I got a 2048-bit RSA private key (password-protected using 256-bit AES encryption) and a self-signed certificate that is valid for 2 years.

## Preparing for IP forwarding

On both the VPN server and the edge router, it is essential that IP forwarding be enabled in the kernel.

```bash
echo "net.ipv4.ip_forward=1" | tee /etc/sysctl.conf
sysctl -p
```

## Public VPN

### Preparing the server certificate

On the public VPN server, I generated a key and certificate signing request (CSR).

```bash
openssl genrsa -out server.key 2048
openssl req -new -key server.key
```

Notice that this time, I did not use AES encryption to secure the private key. This is because I wanted OpenVPN to be able to start without requiring me to enter a password to decrypt the private key upon startup. Next, I copied the CSR to my local machine for signing.

To align with the [best practices](http://openvpn.net/index.php/open-source/documentation/miscellaneous/77-rsa-key-management.html) for OpenVPN, I made sure to use the nsCertType extension when signing the server certificate. First, I created a file named extensions.cnf with the following:

```
[server]
nsCertType=server
```

Then I ran the OpenSSL signing tool with the specified extensions and pasted the server CSR into it.

```
openssl x509 -req -CA ca.crt -CAkey ca.key -CAcreateserial -days 365 -extfile extensions.cnf -extensions server
```

Now I take the signed certificate and copy it back to the VPN server into a file named `server.crt`.

### Installing OpenVPN

I installed from the package manager on the VPN server using `apt-get install openvpn`.

Next, I moved server's certificate and key to /etc/openvpn, as well as the CA's certificate. Then I created a file named /etc/openvpn/inner.conf with the following content.

```
dev tun
port 1195

ifconfig 10.9.0.1 10.9.0.2

tls-server

ca ca.crt
cert server.crt
key server.key

verify-x509-name PUT-YOUR-EDGE-ROUTER-CN-HERE name

dh dh1024.pem

comp-lzo yes

keepalive 10 60
ping-timer-rem
persist-tun
persist-key

route PUT-YOUR-NETWORK-HERE PUT-YOUR-NETMASK-HERE
```

A few notes about this configuration:

* This will only permit a single remote peer, the edge router. It does this by enforcing the common name used by the edge router's X509 certificate
* The edge router will have a static IP address on this side of the tunnel
* Once the VPN tunnel is established, a route will be added that exposes the private network to the VPN server through the edge router (in my case, it is the network `172.20.0.0/16`)

Lastly, generate the Diffie-Hellman parameters and restart the OpenVPN service.

```
openssl dhparam -out /etc/openvpn/dh1024.pem 1024
```

## Edge router

### Preparing the client certificate

On the edge router, I need a certificate as well. It's important that the common name (CN) used to generate the certificate request is exactly the same as the CN that the VPN server expects.

```
openssl genrsa -out client.key 2048
openssl req -new -key client.key
```

Then I generated a signed certificate on my local machine and copied it back to the edge router.

```
openssl x509 -req -CA ca.crt -CAkey ca.key -days 365
```

### Installing OpenVPN

Again, I installed OpenVPN from the package manager. Next, I moved the client's certificate and key, plus the CA's certificate to `/etc/openvpn`. Then I created `/etc/openvpn/inside.conf` with the following contents.

```
dev tun
remote PUT-YOUR-VPN-SERVER-IP-OR-HOSTNAME-HERE 1195

ifconfig 10.9.0.2 10.9.0.1

tls-client

ca ca.crt
cert client.crt
key client.key

ns-cert-type server

verify-x509-name PUT-YOUR-VPN-SERVER-CN-HERE name

comp-lzo yes

keepalive 10 60
ping-timer-rem
persist-tun
persist-key
```

Finally I restarted OpenVPN. After this, I was able to ping the two hosts from each other using the shared `10.9.0.0/24` subnet.

This is a very typical setup process for OpenVPN in SSL/TLS mode, the main difference is that both ends of the VPN tunnel will verify the CN of each X509 certificate.

The first time I set this side of the VPN tunnel up, I used a static key. This would probably be fine, except that I wanted perfect forward secrecy, which is not achievable with symmetric keys. This is mentioned in the OpenVPN static key how-to.

## Preparing the VPN server for clients

### Client certificate

Now that I had a working site-to-site tunnel between the public VPN server and the private router, the last part was to start accepting VPN clients from the Internet. Obviously this starts by the client generating a private key and CSR.

I chose to generate a single certifcate/key pair for all VPN clients for convenience reasons. I also chose to store the private key in plaintext, rather than encrypting it with AES. Of course, this is totally up to you if you wish to be more secure.

```
openssl genrsa -out client.key 2048
openssl req -new -key client.key
```

Then I generated the signed client certificate.

```
openssl x509 -req -CA ca.crt -CAkey ca.key -days 365
```

### Public VPN server

Now, on the VPN server, I added an additional config file named `/etc/openvpn/server.conf` with the following content.

```
port 1194
dev tun

tls-server

ca ca.crt
cert server.crt
key server.key

dh dh1024.pem

tls-auth ta.key 0

server 10.8.0.0 255.255.255.0

ifconfig-pool-persist ipp.txt

push "route PUT-YOUR-NETWORK-HERE PUT-YOUR-NETMASK-HERE"
push "dhcp-option DNS PUT-YOUR-DNS-IP-HERE"

client-to-client
duplicate-cn

keepalive 10 120

comp-lzo yes

keepalive 10 60
ping-timer-rem
persist-tun
persist-key
```

Some notes about this configuration file:

* I chose to use the HMAC firewall functionality in OpenVPN. This involves generating a shared secret using `openvpn --genkey --secret ta.key` and distributing it to the server and clients. It is used to prevent DoS attacks and UDP port flooding
* Along with the private network route, I also push the internal DNS server for clients to use

### Routing options

At this point, you would be able to connect your VPN client to this server and get routed to the private network. Unfortunately, it does not have a way to route back to your client. There are a few options here.

* (on the public VPN server) NAT masquerade from VPN client subnet to the private network

```
iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -d 172.20.0.0/16 -j MASQUERADE
```

* (on the edge router) Add a route from the edge router to the VPN client subnet

```
ip route add 10.8.0.0/24 via 10.9.0.1
```

* (on the edge router) Add a route from the edge router to the VPN client subnet + NAT masquerade

```
ip route add 10.8.0.0/24 via 10.9.0.1
iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -d 172.20.0.0/16 -j MASQUERADE
```

Any of these ways will work, it just depends on how you want it. I chose the last option in my deployment because I wanted traffic to appear to be coming from my edge router to the rest of the network (personal preference).

To persist these, create an executable shell script at `/etc/network/if-pre-up.d/iptables` in the style of the following:

```bash
#!/bin/bash
iptables -F -t nat
iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -d 172.20.0.0/16 -j MASQUERADE
```

If your particular Linux distribution provides iptables persistence out of the box, prefer that instead (this includes RHEL and CentOS).

For the routes, just add them to `/etc/openvpn/inside.conf` using the `route` directive.

## Wrap-up

There you have it, a solution that uses OpenVPN and simple Linux networking tricks to bust through any sort of NAT. This setup provides perfect forward secrecy through its use of TLS. For even more security, consider integrating two-factor authentication with [Authy](https://github.com/authy/authy-openvpn) or Google Authenticator. You could also use additional username/password authentication with PAM.

Good luck!

