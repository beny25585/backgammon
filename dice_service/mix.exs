defmodule DiceService.MixProject do
  use Mix.Project

  def project do
    [
      app: :dice_service,
      version: "0.1.0",
      elixir: "~> 1.17",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      description: description(),
      package: package()
    ]
  end

  def application do
    [
      extra_applications: [:logger, :crypto],
      mod: {DiceService.Application, []}
    ]
  end

  defp deps do
    [
      {:plug_cowboy, "~> 2.7"},
      {:jason, "~> 1.4"}
    ]
  end

  defp description do
    "Internal dice service for the Backgammon game, backed by Backgammon-Galaxy/dice_roller."
  end

  defp package do
    [
      licenses: ["MIT"]
    ]
  end
end
