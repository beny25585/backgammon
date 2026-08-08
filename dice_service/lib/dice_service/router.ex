defmodule DiceService.Router do
  @moduledoc """
  HTTP router for the dice service.

  Endpoints:

    * `GET /health`                -> 200 `{"status":"ok"}`
    * `GET /roll?type=opening`     -> 200 `{"dice":[a,b]}` with a != b
    * `GET /roll?type=normal`      -> 200 `{"dice":[a,b]}` (doubles allowed)
    * `GET /roll`                  -> 200 `{"dice":[a,b]}` (defaults to normal)
    * anything else                -> 404

  Every request is logged as `[dice] METHOD path?query -> status (duration)`.
  Exceptions are caught, logged with a stacktrace, and returned as 500s.
  """

  use Plug.Router

  require Logger

  plug(:match)
  plug(:dispatch)

  @impl true
  def call(conn, opts) do
    start = System.monotonic_time(:microsecond)
    target = request_target(conn)

    conn =
      try do
        super(conn, opts)
      rescue
        error ->
          Logger.error("[dice] #{conn.method} #{target} -> 500 (raised)")
          Logger.error(Exception.format(:error, error, __STACKTRACE__))
          send_resp(conn, 500, Jason.encode!(%{"error" => "internal error"}))
      end

    duration = System.monotonic_time(:microsecond) - start
    status = conn.status || 500

    level =
      case status do
        s when s >= 500 -> :error
        s when s >= 400 -> :warning
        _ -> :info
      end

    Logger.log(level, "[dice] #{conn.method} #{target} -> #{status} (#{div(duration, 1000)}ms)")
    conn
  end

  get "/health" do
    send_resp(conn, 200, Jason.encode!(%{"status" => "ok"}))
  end

  get "/roll" do
    type =
      case Plug.Conn.fetch_query_params(conn).query_params["type"] do
        "opening" -> :opening
        _ -> :normal
      end

    [a, b] = DiceService.roll(type)
    send_resp(conn, 200, Jason.encode!(%{"dice" => [a, b]}))
  end

  match _ do
    send_resp(conn, 404, Jason.encode!(%{"error" => "not found"}))
  end

  defp request_target(conn) do
    if conn.query_string == "", do: conn.request_path, else: "#{conn.request_path}?#{conn.query_string}"
  end
end
