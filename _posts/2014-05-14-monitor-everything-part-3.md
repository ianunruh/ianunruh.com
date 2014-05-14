---
layout: post
title: "Monitoring Everything (Part 3)"
date: 2014-05-14 16:14:00
comments: true
---

By the end of the [previous post](/2014/05/monitor-everything-part-2.html), logs were flowing from multiple sources into Logstash. In this post, we'll start looking at scaling out and improving the existing architecture.

## Scaling out

**tl;dr you can horizontally scale out this architecture as much as needed**

![Simple broker architecture](/images/simple-broker.png)

We currently have a system that looks like the above image. This will support a small amount of nodes, but provides no load balancing or high availability. Of course, depending on the importance you place on logs, this may not matter at all.

If you do place importance on your logs, or have a high volume of logs, proceed to the next few reference architectures.

### Scaling out Redis

![Simple broker architecture w/ load balancing](/images/simple-broker-lb.png)

If we fire up multiple Redis instances on the same node, we get a bit more availability if we need to do Redis upgrades or restarts. There are a plethora of tutorials on the Internet for this, like [this question on ServerFault](http://serverfault.com/questions/183999/how-do-i-configure-another-instance-of-redis-on-ubuntu). On the indexer, add additional inputs for each Redis instance.

```
input {
  redis {
    host => "your-redis-server"
    port => 6379
    data_type => "list"
    key => "logstash"
  }

  redis {
    host => "your-redis-server"
    port => 6380
    data_type => "list"
    key => "logstash"
  }
}
```

On the shippers, configure a Redis output with multiple hosts.

```
output {
  redis {
    host => ["your-redis-server:6379", "your-redis-server:6380"]
    shuffle_hosts => true
  }
}
```

If the monitoring server crashes, it takes everything with it. If it's down long enough, the shippers will start discarding their backlog to avoid filling up memory. This takes us to the next architecture.

![Simple broker architecture w/ load balancing and HA](/images/simple-broker-ha-lb.png)

If we split Redis out of the monitoring node onto a couple other nodes, we get load balancing and high availability. Distribute these across data centers to provide tolerance against network partitions.

The configuration on Logstash is the same, except for adjusting the hosts you connect to.

This will perform well until the bottleneck becomes the indexer itself.

### Scaling out the indexer

![Multiple indexers w/ load balancing](/images/lb-indexer.png)

When you get to the point where a single indexer can't keep up with the incoming logs, just split out Elasticsearch onto its own node and fire up more indexers.

![Multiple indexers w/ load balancing and HA](/images/ha-lb-indexer.png)

Finally, you can create a full mesh between all nodes. If you enable `shuffle_hosts` on the Redis output on your shippers, Logstash should provide some even distribution between the Redis nodes. The Logstash indexers will take turns consuming the queues from both Redis hosts. You can even mesh on the producer side and partition on the consumer side (or vice versa). **It's all up to you.**

### Scaling out Elasticsearch

If Elasticsearch becomes the bottleneck, [you can easily create a cluster](http://www.elasticsearch.org/guide/en/elasticsearch/guide/current/distributed-cluster.html) of Elasticsearch nodes and shard/replicate data as needed. You can even put a TCP load banacer between Kibana and Elasticsearch. By default, Logstash will shard the index by day, though you can customize this with the `index` option.

Depending on how long you want to retain logs, you can easily delete old indexes with tools like [Curator](https://github.com/elasticsearch/curator). After that, you can recycle existing Elasticsearch nodes for newer logs.

<hr>

## Security

### Redis

Redis provides simple authentication, but no transport-layer encryption or authorization. In trusted environments, this is perfectly fine. However, if you're connecting to Redis between datacenters, you'll probably want to use encryption. This means using an SSL tunnel. Your options include the following.

- [autossh](http://tech.3scale.net/2012/07/25/fun-with-redis-replication/)
- [stunnel](http://bencane.com/2014/02/18/sending-redis-traffic-through-an-ssl-tunnel-with-stunnel/)

From what I can tell, `autossh` has the least overhead and seems to be the accepted way to proxy Redis over SSL. Setup autossh on each node with Logstash. Then configure a password on Redis and distribute that to all your Logstash nodes.

### Elasticsearch

Like Redis, Elasticsearch does not have transport-layer encryption. It also does not have authorization or authentication. There various plugins for adding authentication and encryption, but they will probably make Elasticsearch incompatible with other applications. The only non-invasive option left is using an SSL tunnel, just like with Redis.

### Kibana

Kibana does not come with authentication out of the box. I'm sure you're starting to see a common theme here, but I think it's beneficial that these applications are kept as simple as possible. Fortunately, it's possible to proxy traffic to Kibana through something like nginx or Rack, providing SSL termination and HTTP basic authentication. This can be done [many](http://technosophos.com/2014/03/19/ssl-password-protection-for-kibana.html) [different](https://github.com/elasticsearch/kibana/blob/master/sample/nginx.conf) [ways](https://github.com/christian-marie/kibana3_auth).

<hr>

## Slimming down

As I alluded to in the last post, Logstash itself can be too large to run on your micro cloud instances. If we still want logs from these servers, however, we need a shipper with a smaller memory footprint. This is where [logstash-forwarder](https://github.com/elasticsearch/logstash-forwarder) comes in.

### Preparing the indexer

It's relatively easy to prepare the indexer to receive logs via Lumberjack, the underlying protocol used by `logstash-forwarder`. Just create `/etc/logstash/conf.d/10-input-lumberjack.conf` with the following.

```
input {
  lumberjack {
    port => 5043
    ssl_certificate => "/etc/logstash/forwarder.crt"
    ssl_key => "/etc/logstash/forwarder.key"
  }
}
```

The next step is generating the SSL certificate used for transport encryption.

```sh
openssl req -x509 -batch -nodes -newkey rsa:2048 -keyout forwarder.key -out forwarder.crt

cp forwarder.crt forwarder.key /etc/logstash
chown logstash:logstash /etc/logstash/forwarder.crt /etc/logstash/forwarder.key
chmod 640 /etc/logstash/forwarder.key

service logstash restart
```

### Installation

First, we'll need to secure copy the certificate and key to `/etc/logstash-forwarder` on each node we want to ship logs from. After that, we can install `logstash-forwarder`. I've created a [simple script](https://github.com/ianunruh/monitoring/blob/master/install-logstash-forwarder.sh) that you can run on your nodes to compile and install it.

```sh
apt-get install -y git

git clone git://github.com/ianunruh/monitoring.git
cd monitoring

./install-logstash-forwarder.sh
```

You should now start seeing logs shipping to your indexer. Just edit `/etc/logstash-forwarder/config.json` to customize the files you want to ship, as well as the types assigned to them.

## Wrap-up

In this post, I covered several ways to improve your log aggregation solution. This includes architectures for scaling it out, ways to increase security between various components, and a lighter way to ship logs to your indexer. In the next post, I'll start covering service checks and metrics gathering using Sensu and Graphite.
