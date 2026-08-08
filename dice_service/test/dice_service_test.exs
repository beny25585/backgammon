defmodule DiceServiceTest do
  use ExUnit.Case, async: true

  describe "roll/1" do
    test ":normal returns two values in 1..6, doubles allowed" do
      for _ <- 1..50 do
        [a, b] = DiceService.roll(:normal)
        assert a in 1..6
        assert b in 1..6
      end
    end

    test ":opening never returns doubles" do
      for _ <- 1..50 do
        [a, b] = DiceService.roll(:opening)
        assert a in 1..6
        assert b in 1..6
        refute a == b
      end
    end

    test ":opening can produce different pairs over many rolls" do
      pairs =
        for _ <- 1..200 do
          [a, b] = DiceService.roll(:opening)
          {a, b}
        end

      assert Enum.uniq(pairs) |> length() > 1
    end
  end
end
