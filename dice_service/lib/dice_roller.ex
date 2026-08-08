defmodule DiceRoller do
  @moduledoc """
  A configurable dice rolling library with pluggable implementations.

  The `DiceRoller` module provides a unified interface for rolling dice with
  different implementations. By default, it uses `DiceRoller.CryptoRandom` for
  cryptographically secure randomness, but you can configure it to use any
  implementation that follows the `DiceRoller.Behaviour`.

  ## Configuration

  The implementation can be configured in your application configuration:

      # config/config.exs
      config :dice_roller, impl: DiceRoller.CryptoRandom

      # config/test.exs
      config :dice_roller, impl: DiceRoller.Deterministic

  ## Usage

      # Roll two dice (default behavior)
      DiceRoller.roll()
      # => [3, 5]

      # Roll two dice allowing doubles
      DiceRoller.roll(false)
      # => [2, 2]

      # Roll two dice excluding doubles
      DiceRoller.roll(true)
      # => [4, 1]

  ## Available Implementations

  ### DiceRoller.CryptoRandom (Default)
  - Uses `:crypto.strong_rand_bytes/1` for cryptographically secure randomness
  - Suitable for production use
  - Excludes doubles when `exclude_doubles: true`

  ### Custom Implementations
  You can create your own implementations by implementing the `DiceRoller.Behaviour`:

      defmodule MyCustomDiceRoller do
        @behaviour DiceRoller.Behaviour

        def roll(exclude_doubles \\ false) do
          # Your custom implementation
          [roll_single_dice(), roll_single_dice()]
        end

        defp roll_single_dice do
          # Your custom dice rolling logic
        end
      end

  ## Runtime Configuration

  You can change the implementation at runtime:

      # Temporarily use a different implementation
      original_impl = Application.get_env(:dice_roller, :impl)
      Application.put_env(:dice_roller, :impl, DiceRoller.CryptoRandom)

      # Use the dice roller
      result = DiceRoller.roll()

      # Restore original implementation
      Application.put_env(:dice_roller, :impl, original_impl)

  ## Fallback Behavior

  If no implementation is configured or the configured implementation is invalid,
  the module automatically falls back to `DiceRoller.CryptoRandom`. This ensures
  the library always works, even without proper configuration.

  ## Examples

      # Basic usage
      DiceRoller.roll()
      # => [3, 5]

      # With configuration
      Application.put_env(:dice_roller, :impl, DiceRoller.CryptoRandom)
      DiceRoller.roll(true)
      # => [4, 1]

      # Multiple rolls
      Enum.map(1..5, fn _ -> DiceRoller.roll() end)
      # => [[1, 6], [3, 2], [5, 4], [2, 1], [6, 3]]
  """

  @behaviour DiceRoller.Behaviour

  @default_impl DiceRoller.CryptoRandom

  @doc """
  Rolls two dice and returns the results as a list.

  ## Parameters

    * `exclude_doubles` - A boolean indicating whether to exclude doubles.
      When `true`, the function will keep rolling until it gets two different values.
      When `false` (default), doubles are allowed.

  ## Returns

    * `list(integer())` - A list of two integers, each between 1 and 6.

  ## Examples

      # Roll two dice (default - allows doubles)
      DiceRoller.roll()
      # => [3, 5]

      # Roll two dice allowing doubles
      DiceRoller.roll(false)
      # => [2, 2]

      # Roll two dice excluding doubles (Backgammon match start)
      DiceRoller.roll(true)
      # => [4, 1]  # First dice for host, second for guest

  ## Backgammon Match Start Use Case

  When `exclude_doubles: true`, this function is specifically designed for Backgammon
  match initialization where:
  - First dice value determines the host player's opening move
  - Second dice value determines the guest player's opening move
  - Both players must have different opening moves (no doubles allowed)
  - Ensures fair and varied opening moves for both players

  ## Configuration

  The actual implementation used is determined by the `:dice_roller` application
  configuration. If no implementation is configured or the configured implementation
  is invalid, it falls back to `DiceRoller.CryptoRandom`.

      # Configure implementation
      config :dice_roller, impl: DiceRoller.CryptoRandom

  ## Behaviour Compliance

  This function implements the `DiceRoller.Behaviour` callback `roll/1`.
  """
  def roll(exclude_doubles \\ false) do
    impl().roll(exclude_doubles)
  end

  @doc false
  @spec impl() :: module()
  defp impl do
    case Application.get_env(:dice_roller, :impl) do
      nil ->
        @default_impl

      impl when is_atom(impl) and impl != nil ->
        if Code.ensure_loaded?(impl) and function_exported?(impl, :roll, 1) do
          impl
        else
          @default_impl
        end

      _ ->
        @default_impl
    end
  end
end
