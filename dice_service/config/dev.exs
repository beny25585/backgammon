import Config

config :dice_service, port: String.to_integer(System.get_env("PORT") || "4000")
