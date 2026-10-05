// BEGIN BACKGAMMON METRICS
// Runs in the EXISTING host Alloy service, not inside an application container.
prometheus.exporter.cadvisor "backgammon_containers" {
  docker_host                   = "unix:///var/run/docker.sock"
  docker_only                   = true
  disable_root_cgroup_stats      = true
  store_container_labels        = false
  allowlisted_container_labels  = ["com.docker.compose.project", "com.docker.compose.service"]
  enabled_metrics               = ["cpu", "memory"]
}

prometheus.scrape "backgammon_containers" {
  targets         = prometheus.exporter.cadvisor.backgammon_containers.targets
  job_name        = "backgammon_containers"
  scrape_interval = "15s"
  scrape_timeout  = "10s"
  forward_to      = [prometheus.relabel.backgammon_containers.receiver]
}

prometheus.relabel "backgammon_containers" {
  forward_to = [prometheus.remote_write.backgammon_metrics.receiver]
  rule {
    source_labels = ["container_label_com_docker_compose_project"]
    regex         = "backgammon-production"
    action        = "keep"
  }
  rule {
    source_labels = ["container_label_com_docker_compose_service"]
    target_label  = "service"
  }
  rule {
    target_label = "stack"
    replacement  = "backgammon-production"
  }
  rule {
    target_label = "instance"
    replacement  = constants.hostname
  }
  rule {
    action = "labeldrop"
    regex  = "container_label_.*|image"
  }
}

prometheus.exporter.unix "backgammon_host" {
  set_collectors = ["cpu", "meminfo", "loadavg"]
}

discovery.relabel "backgammon_host" {
  targets = prometheus.exporter.unix.backgammon_host.targets
  rule {
    target_label = "job"
    replacement  = "backgammon_host"
  }
  rule {
    target_label = "stack"
    replacement  = "backgammon-production"
  }
  rule {
    target_label = "instance"
    replacement  = constants.hostname
  }
}

prometheus.scrape "backgammon_host" {
  targets         = discovery.relabel.backgammon_host.output
  job_name        = "backgammon_host"
  scrape_interval = "15s"
  scrape_timeout  = "10s"
  forward_to      = [prometheus.remote_write.backgammon_metrics.receiver]
}

prometheus.remote_write "backgammon_metrics" {
  endpoint {
    url = "http://127.0.0.1:19090/api/v1/write"
    queue_config {
      min_shards           = 1
      max_shards           = 2
      capacity             = 2500
      max_samples_per_send = 500
    }
  }
}
// END BACKGAMMON METRICS
