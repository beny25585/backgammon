defmodule DiceService.RouterTest do
  use ExUnit.Case, async: true
  import Plug.Test

  alias DiceService.Router

  test "GET /health returns 200" do
    conn = conn(:get, "/health") |> Router.call([])

    assert conn.status == 200
    assert Jason.decode!(conn.resp_body) == %{"status" => "ok"}
  end

  test "GET /roll defaults to normal (doubles allowed)" do
    conn = conn(:get, "/roll") |> Router.call([])

    assert conn.status == 200
    assert Plug.Conn.get_resp_header(conn, "cache-control") == ["no-store"]
    assert Plug.Conn.get_resp_header(conn, "x-dice-request-id") == []
    assert %{"dice" => [a, b]} = Jason.decode!(conn.resp_body)
    assert a in 1..6
    assert b in 1..6
  end

  test "GET /roll?type=normal returns valid dice" do
    request_id = String.duplicate("a", 32)

    conn =
      conn(:get, "/roll?type=normal")
      |> Plug.Conn.put_req_header("x-dice-request-id", request_id)
      |> Router.call([])

    assert conn.status == 200
    assert Plug.Conn.get_resp_header(conn, "cache-control") == ["no-store"]
    assert Plug.Conn.get_resp_header(conn, "x-dice-request-id") == [request_id]
    assert %{"dice" => [a, b]} = Jason.decode!(conn.resp_body)
    assert a in 1..6
    assert b in 1..6
  end

  test "GET /roll ignores malformed and repeated request IDs" do
    request_id = String.duplicate("a", 32)

    for ids <- [[String.duplicate("g", 32)], [request_id, request_id]] do
      headers = Enum.map(ids, &{"x-dice-request-id", &1})

      conn =
        conn(:get, "/roll")
        |> Plug.Conn.prepend_req_headers(headers)
        |> Router.call([])

      assert conn.status == 200
      assert Plug.Conn.get_resp_header(conn, "x-dice-request-id") == []
    end
  end

  test "GET /roll?type=opening never returns doubles" do
    for _ <- 1..50 do
      conn = conn(:get, "/roll?type=opening") |> Router.call([])

      assert conn.status == 200
      assert %{"dice" => [a, b]} = Jason.decode!(conn.resp_body)
      assert a in 1..6
      assert b in 1..6
      refute a == b
    end
  end

  test "GET /roll?type=bogus falls back to normal" do
    conn = conn(:get, "/roll?type=bogus") |> Router.call([])

    assert conn.status == 200
    assert %{"dice" => [_a, _b]} = Jason.decode!(conn.resp_body)
  end

  test "unknown route returns 404" do
    conn = conn(:get, "/nope") |> Router.call([])

    assert conn.status == 404
  end
end
