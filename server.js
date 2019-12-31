var http = require('http')
var fs = require('fs')

const MAC_FILE = '/var/lib/libvirt/dnsmasq/virbr0.macs'
const LEASE_FILE = '/var/lib/libvirt/dnsmasq/virbr0.status'

const DATA = {
    pubkey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDErg78hw2c7U7xEp39+anK2YzuCo4XQFKlr/ZTWcCTRTq14Fa/RXoza7GJHMrxIqYf5R5mZ0KPfYngTVKoc0YjtZOU/85+T0Xw+gVapmAeuVRZAn6P+zJi3tz9fUrPN4Z04ag8ZAnyvDOh5WCXdLIy6FzhzL+wvACYN7D+buDmOEx+xyKMBstV+LDxQdtcZQcRzquqRkzpsdhvq9OLJGB2kt6d8XiILgHsTCmOhGQGZPkVBT8ZUFVIzg3mOAw69MiDfhTJ48Ex2Lp0vqNq9kTemUobsHhj+7E3Aq24YdoQp7HG4x3m+Gu3CNcukUClVQc/CKSjtCZ+0SKrQ2+QjVpenEHUP4gKI/RAuY/f5Xlnm2c5QE33uapMhvOcsoa7nCOcgFHhpD9paSzqYq9+AbCx6+kTRAc7by1kQBUG6blDMu/CAuRyLnLKsc4kEatP8u0MyjOy9eu632SUXOWQoUzvbA7KLl0V0XnpdpyvS6wBbWTNv1BfNsaD7dIjP2bafms='
}

function genUserData(hostname, pubkey) {
    return `
#cloud-config
hostname: ${hostname}
local-hostname: ${hostname}
fqdn: ${hostname}.homelab.net
manage_etc_hosts: true
password: changeme
chpasswd: { expire: False }
ssh_pwauth: True
ssh_authorized_keys:
    - ${pubkey}

runcmd:
    - yum erase cloud-init -y
`
}

function readJSONFile(filename) {
    return new Promise((resolve, reject) => {
        fs.readFile(filename, 'utf8', (err, data) => {
            if (err) {
                console.error(err)
                return resolve(undefined)
            }

            return resolve(JSON.parse(data))
        })
    })
}

function findDomainByMac(macs_db, mac) {
    return macs_db.find(r => r.macs.includes(mac))
}

async function findDomainByIP(ip) {
    let domain_db = await get_domain_db()
    return domain_db.find(d => d.ip === ip)
}

async function get_domain_db() {
    let macs = await readJSONFile(MAC_FILE)
    let leases = await readJSONFile(LEASE_FILE)

    let db = []
    leases.forEach(lease => {
        let domain = findDomainByMac(macs, lease['mac-address'])
        if (domain) {
            domain.ip = lease['ip-address']
            db.push(domain)
        }
    })

    return db
};

async function writesToHosts(hostname, ip) {
    let file = '/etc/hosts'

    let old = `
127.0.0.1   localhost localhost.localdomain localhost4 localhost4.localdomain4
::1         localhost localhost.localdomain localhost6 localhost6.localdomain6

192.168.122.10	ces.c01.homelab.net
192.168.122.11	ces.c01.homelab.net
`
    let db = await get_domain_db();

    let content = []
    db.forEach(r => {
        content.push(r.ip + "      " + r.domain + "  " + r.domain + ".homelab.net")
    })

    hostsContent = old + content.join('\n')

    fs.writeFile(file, hostsContent, 'utf8', (err) => {
        console.log(err)
    })
}

var mds = {

    getInstanceId: function (req, res) {
        let ip = req.connection.remoteAddress
        res.write('i-' + ip.replace('.', '-'))
        res.end()
    },

    getUserData: async function (req, res) {
        let ip = req.connection.remoteAddress
        let domain = await findDomainByIP(ip)
        //console.log({ domain, ip })
        let userdata = genUserData(domain.domain, DATA.pubkey)
        //console.log(userdata)
        res.write(userdata)
        res.end()
    },

    getMetaData: function (req, res) {
        res.write('instance-id\nhostname\npublic-keys\n\n')
        res.end()
    },
    getHostname: async function (req, res) {
        let ip = req.connection.remoteAddress
        let domain = await findDomainByIP(ip)

        if (domain) writesToHosts(domain.domain, ip)

        res.write(domain + '\n')
        res.end()
    },
    getPublicKeys: function (req, res) {
        res.write(DATA.pubkey + '\n')
        res.end()
    }
};

(async function () {
    //let domain = await findDomainByIP('192.168.122.92')

    http.createServer(async (req, res) => {
        console.log(req.url)
        switch (true) {
            case /instance-id/.test(req.url):
                mds.getInstanceId(req, res); break
            case /user-data/.test(req.url):
                await mds.getUserData(req, res); break
            case /meta-data\/$/.test(req.url):
                mds.getMetaData(req, res); break;
            case /meta-data\/hostname$/.test(req.url):
                await mds.getHostname(req, res); break;
            case /meta-data\/public-keys$/.test(req.url):
                mds.getPublicKeys(req, res); break;
            default:
                console.log('not handler found ' + req.url)
        }
    }).listen(80, '169.254.169.254')
})()
