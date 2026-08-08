defmodule DiceRoller.Behaviour do
  @moduledoc """
  A behaviour for dice rolling implementations.

  This behaviour defines the contract that all dice rolling implementations must follow.
  It provides a standardized interface for rolling dice, allowing different implementations
  to be used interchangeably through the main DiceRoller module.


  ## Callback Specification

  ### roll/1

  Rolls two dice and returns the results as a list.

  **Parameters:**
  - exclude_doubles - A boolean indicating whether to exclude doubles.
    When true, the function should keep rolling until it gets two different values.
    When false, doubles are allowed.

  **Returns:**
  - list(pos_integer()) - A list of exactly two integers, each between 1 and 6.

  **Special Use Case - Backgammon Match Start:**

  When `exclude_doubles: true`, this function is specifically designed for the beginning
  of a Backgammon match where:
  - The first dice determines the host player's opening move
  - The second dice determines the guest player's opening move
  - Both players must have different opening moves (no doubles allowed)

  This ensures fair and varied opening moves for both players at the start of each match.

  ## Example Implementation

      defmodule MyCustomDiceRoller do
        @behaviour DiceRoller.Behaviour

        @doc \"\"\"
        Rolls two dice using a custom algorithm.
        \"\"\"
        def roll(exclude_doubles \\\\ false) do
          case exclude_doubles do
            true -> roll_until_different()
            false -> [roll_single_dice(), roll_single_dice()]
          end
        end

        defp roll_until_different do
          dice1 = roll_single_dice()
          dice2 = roll_single_dice()

          if dice1 == dice2 do
            roll_until_different()
          else
            [dice1, dice2]
          end
        end

        defp roll_single_dice do
          # Your custom dice rolling logic here
          :rand.uniform(6)
        end
      end

  ## Available Implementations

  ### DiceRoller.CryptoRandom
  - Uses :crypto.strong_rand_bytes/1 for cryptographically secure randomness
  - Suitable for production environments
  - Handles edge cases in cryptographic random number generation
  - Implements recursive logic for exclude_doubles: true

  ### DiceRoller.Deterministic (for testing)
  - Always returns predictable results (typically all ones)
  - Useful for testing and debugging
  - Ensures consistent test outcomes
  - Implements the same interface as other implementations

  ## Configuration

  Implementations are configured through the :dice_roller application environment:

      # config/config.exs
      config :dice_roller, impl: DiceRoller.CryptoRandom

      # config/test.exs
      config :dice_roller, impl: DiceRoller.Deterministic

  ## Usage

  Once implemented, modules can be used through the main DiceRoller interface:

      # Configure your implementation
      Application.put_env(:dice_roller, :impl, MyCustomDiceRoller)

      # Use the dice roller
      DiceRoller.roll()
      # => [3, 5]

      DiceRoller.roll(true)
      # => [4, 1]  # No doubles

  ## Testing Your Implementation

  When implementing this behaviour, you should test:

  1. **Basic functionality**: Returns a list of two integers between 1 and 6
  2. **exclude_doubles=false**: Allows doubles to be returned
  3. **exclude_doubles=true**: Never returns doubles
  4. **Edge cases**: Handles any edge cases specific to your implementation
  5. **Performance**: Ensures reasonable performance characteristics

  ## Behaviour Compliance

  The main DiceRoller module automatically validates that configured implementations
  follow this behaviour contract. If an implementation does not export the required
  roll/1 function, the system falls back to the default implementation.

  ## Notes

  - All implementations should return exactly two integers
  - Each integer should be between 1 and 6 (inclusive)
  - The exclude_doubles parameter should be respected
  - Implementations should handle errors gracefully
  - Consider performance implications of your implementation
  """

  @doc """
  Rolls two dice and returns the results as a list.

  This callback must be implemented by all modules that adopt the DiceRoller.Behaviour.

  ## Parameters

    * exclude_doubles - A boolean indicating whether to exclude doubles.
      When true, the function should keep rolling until it gets two different values.
      When false, doubles are allowed.

  ## Returns

    * list(pos_integer()) - A list of exactly two integers, each between 1 and 6.

  ## Examples

      # Allow doubles
      MyImplementation.roll(false)
      # => [2, 2]

      # Exclude doubles (Backgammon match start)
      MyImplementation.roll(true)
      # => [3, 5]  # First dice for host, second for guest

  ## Backgammon Match Start Use Case

  When `exclude_doubles: true`, this function is specifically designed for Backgammon
  match initialization where:
  - First dice value determines the host player's opening move
  - Second dice value determines the guest player's opening move
  - Both players must have different opening moves (no doubles allowed)
  - Ensures fair and varied opening moves for both players

  ## Implementation Notes

  - Must return exactly two integers
  - Each integer must be between 1 and 6 (inclusive)
  - When exclude_doubles is true, must never return two identical values
  - Should handle any implementation-specific edge cases
  - Performance should be reasonable for the intended use case
  """
  @callback roll(exclude_doubles :: boolean) :: list(pos_integer)
end
