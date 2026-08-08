defmodule DiceService.Application do
  @moduledoc """
  OTP application that boots the `Plug.Cowboy` HTTP server.

  The listen port is read from the `PORT` environment variable (default 4000).
  The service is internal-only: it binds to localhost by default.
  """

  use Application

  @impl true
  def start(_type, _args) do
    Application.put_env(:dice_roller, :impl, DiceRoller.CryptoRandom)

    port =
      Application.get_env(:dice_service, :port, 4000)
      |> maybe_from_env(System.get_env("PORT"))

    children = [
      {Plug.Cowboy,
       scheme: :http,
       plug: DiceService.Router,
       options: [
         port: port,
         ip: {127, 0, 0, 1}
       ]}
    ]

    opts = [strategy: :one_for_one, name: DiceService.Supervisor]
    Supervisor.start_link(children, opts)
  end

  defp maybe_from_env(_default, env) when is_binary(env) and env != "" do
    String.to_integer(env)
  end

  defp maybe_from_env(default, _env) do
    default
  end
end
