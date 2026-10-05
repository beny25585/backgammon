// BEGIN BACKGAMMON DOCKER LOGS
// Append to the existing /etc/alloy-config.hcl, keeping loki.write.local.
// This is an addition, not a replacement configuration.
discovery.docker "backgammon_production" {
  host             = "unix:///var/run/docker.sock"
  refresh_interval = "15s"
  filter {
    name   = "label"
    values = ["com.docker.compose.project=backgammon-production"]
  }
}

discovery.relabel "backgammon_production" {
  targets = discovery.docker.backgammon_production.targets
  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_project"]
    regex         = "backgammon-production"
    action        = "keep"
  }
  rule {
    source_labels = ["__meta_docker_container_label_com_docker_compose_service"]
    target_label  = "service"
  }
  rule {
    source_labels = ["__meta_docker_container_name"]
    regex         = "/(.*)"
    target_label  = "container"
  }
  rule {
    target_label = "job"
    replacement  = "backgammon_docker"
  }
  rule {
    source_labels = ["service"]
    regex         = "game-(api|tasks|migrate)"
    target_label  = "job"
    replacement   = "backgammon"
  }
  rule {
    source_labels = ["service"]
    regex         = "tournaments-(api|tasks|migrate|transfer)|push-worker"
    target_label  = "job"
    replacement   = "backgammon_tournaments_backend"
  }
  rule {
    source_labels = ["service"]
    regex         = "analysis-(api|worker|migrate)"
    target_label  = "job"
    replacement   = "backgammon_analysis"
  }
  rule {
    source_labels = ["service"]
    regex         = "(dice|postgres|redis)"
    target_label  = "job"
    replacement   = "backgammon_$1"
  }
  rule {
    source_labels = ["service"]
    regex         = "(game|tournaments|admin)-frontend"
    target_label  = "job"
    replacement   = "backgammon_frontend"
  }
  rule {
    source_labels = ["service"]
    target_label  = "component"
  }
  rule {
    source_labels = ["service"]
    regex         = "(game|tournaments|analysis)-api"
    target_label  = "component"
    replacement   = "api"
  }
  rule {
    source_labels = ["service"]
    regex         = "(game|tournaments)-tasks"
    target_label  = "component"
    replacement   = "tasks"
  }
  rule {
    source_labels = ["service"]
    regex         = "analysis-worker"
    target_label  = "component"
    replacement   = "worker"
  }
}

loki.source.docker "backgammon_production" {
  host             = "unix:///var/run/docker.sock"
  targets          = discovery.relabel.backgammon_production.output
  labels           = { source = "docker", stack = "backgammon-production" }
  refresh_interval = "15s"
  forward_to       = [loki.write.local.receiver]
}
// END BACKGAMMON DOCKER LOGS
