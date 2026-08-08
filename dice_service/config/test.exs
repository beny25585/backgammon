import Config

if config_env() == :test do
  config :dice_service, port: 0
end
