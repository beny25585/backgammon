defmodule DiceService do
  @moduledoc """
  Thin wrapper over the vendored `DiceRoller` library.

  `DiceService.roll/1` maps the caller's intent to the underlying
  `DiceRoller.roll/1` flag: opening rolls must never be doubles
  (`exclude_doubles = true`), normal turns allow doubles (`false`).
  """

  @type dice_type :: :opening | :normal
  @type dice :: [pos_integer(), ...]

  @doc """
  Rolls two dice for the given phase.

  Returns `[a, b]` with `a, b in 1..6`. For `:opening` the two values are
  guaranteed to differ; for `:normal` doubles are allowed.
  """
  @spec roll(dice_type()) :: dice()
  def roll(:opening), do: DiceRoller.roll(true)
  def roll(:normal), do: DiceRoller.roll(false)
end
