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
    assert %{"dice" => [a, b]} = Jason.decode!(conn.resp_body)
    assert a in 1..6
    assert b in 1..6
  end

  test "GET /roll?type=normal returns valid dice" do
    conn = conn(:get, "/roll?type=normal") |> Router.call([])

    assert conn.status == 200
    assert %{"dice" => [a, b]} = Jason.decode!(conn.resp_body)
    assert a in 1..6
    assert b in 1..6
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
