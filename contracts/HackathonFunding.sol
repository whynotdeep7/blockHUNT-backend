// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";

contract HackathonFunding is ReentrancyGuard, Pausable {
    address public organizer;

    struct Hackathon {
        uint256 totalFunding;
        bool isFunded;
        bool prizesDistributed;
        bool isEnded;
        address[] winners;
        bool exists; // Track if hackathon has been initialized
    }

    mapping(uint256 => Hackathon) public hackathons;
    uint256[] public activeHackathons;

    event HackathonCreated(uint256 indexed hackathonId);
    event Funded(uint256 indexed hackathonId, uint256 amount);
    event WinnersSet(uint256 indexed hackathonId, address[] winners);
    event PrizeDistributed(uint256 indexed hackathonId, address winner, uint256 amount);
    event HackathonEnded(uint256 indexed hackathonId);
    event Withdrawn(address indexed organizer, uint256 amount);

    modifier onlyOrganizer() {
        require(msg.sender == organizer, "Only organizer can call this");
        _;
    }

    modifier hackathonExists(uint256 hackathonId) {
        require(hackathons[hackathonId].exists, "Hackathon does not exist");
        _;
    }

    constructor() {
        organizer = msg.sender;
    }

    function fundHackathon(uint256 hackathonId) external payable onlyOrganizer whenNotPaused nonReentrant {
        Hackathon storage hackathon = hackathons[hackathonId];
        if (!hackathon.exists) {
            hackathon.exists = true;
            emit HackathonCreated(hackathonId);
        }
        require(!hackathon.isFunded, "Hackathon already funded");
        require(msg.value > 0, "Must send some ETH");

        hackathon.totalFunding = msg.value;
        hackathon.isFunded = true;
        activeHackathons.push(hackathonId);
        emit Funded(hackathonId, msg.value);
    }

    function setWinners(uint256 hackathonId, address[] memory _winners) 
        external 
        onlyOrganizer 
        whenNotPaused 
        hackathonExists(hackathonId) 
    {
        Hackathon storage hackathon = hackathons[hackathonId];
        require(hackathon.isFunded, "Hackathon must be funded");
        require(!hackathon.prizesDistributed, "Prizes already distributed");
        require(_winners.length >= 1 && _winners.length <= 3, "Must select 1-3 winners");

        // Check for duplicate winners
        for (uint256 i = 0; i < _winners.length; i++) {
            require(_winners[i] != address(0), "Invalid winner address");
            for (uint256 j = i + 1; j < _winners.length; j++) {
                require(_winners[i] != _winners[j], "Duplicate winner address");
            }
        }

        hackathon.winners = _winners;
        emit WinnersSet(hackathonId, _winners);
    }

    function distributePrizes(uint256 hackathonId) 
        external 
        onlyOrganizer 
        whenNotPaused 
        nonReentrant 
        hackathonExists(hackathonId) 
    {
        Hackathon storage hackathon = hackathons[hackathonId];
        require(hackathon.isFunded, "Hackathon must be funded");
        require(hackathon.winners.length > 0, "Winners not set");
        require(!hackathon.prizesDistributed, "Prizes already distributed");
        require(hackathon.isEnded, "Hackathon must be ended");
        require(address(this).balance >= hackathon.totalFunding, "Insufficient contract balance");

        uint256 totalDistributed = 0;
        if (hackathon.winners.length == 3) {
            uint256 prizeAmount1 = (hackathon.totalFunding * 50) / 100;
            uint256 prizeAmount2 = (hackathon.totalFunding * 30) / 100;
            uint256 prizeAmount3 = hackathon.totalFunding - prizeAmount1 - prizeAmount2;

            _safeTransfer(hackathon.winners[0], prizeAmount1, hackathonId);
            totalDistributed += prizeAmount1;

            _safeTransfer(hackathon.winners[1], prizeAmount2, hackathonId);
            totalDistributed += prizeAmount2;

            _safeTransfer(hackathon.winners[2], prizeAmount3, hackathonId);
            totalDistributed += prizeAmount3;
        } else if (hackathon.winners.length == 2) {
            uint256 prizeAmount1 = (hackathon.totalFunding * 70) / 100;
            uint256 prizeAmount2 = hackathon.totalFunding - prizeAmount1;

            _safeTransfer(hackathon.winners[0], prizeAmount1, hackathonId);
            totalDistributed += prizeAmount1;

            _safeTransfer(hackathon.winners[1], prizeAmount2, hackathonId);
            totalDistributed += prizeAmount2;
        } else {
            uint256 prizeAmount = hackathon.totalFunding;
            _safeTransfer(hackathon.winners[0], prizeAmount, hackathonId);
            totalDistributed += prizeAmount;
        }

        require(totalDistributed == hackathon.totalFunding, "Distribution mismatch");
        hackathon.prizesDistributed = true;

        // Remove from active hackathons efficiently
        _removeActiveHackathon(hackathonId);
    }

    function endHackathon(uint256 hackathonId) 
        external 
        onlyOrganizer 
        whenNotPaused 
        hackathonExists(hackathonId) 
    {
        Hackathon storage hackathon = hackathons[hackathonId];
        require(!hackathon.isEnded, "Hackathon already ended");
        hackathon.isEnded = true;
        emit HackathonEnded(hackathonId);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    function getWinners(uint256 hackathonId) 
        external 
        view 
        hackathonExists(hackathonId) 
        returns (address[] memory) 
    {
        return hackathons[hackathonId].winners;
    }

    function withdraw() 
        external 
        onlyOrganizer 
        whenNotPaused 
        nonReentrant 
    {
        require(activeHackathons.length == 0, "Cannot withdraw while prizes are pending");
        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw");

        _safeTransfer(organizer, balance, 0);
        emit Withdrawn(organizer, balance);
    }

    function pause() external onlyOrganizer {
        _pause();
    }

    function unpause() external onlyOrganizer {
        _unpause();
    }

    // Internal function to handle safe ETH transfers
    function _safeTransfer(address recipient, uint256 amount, uint256 hackathonId) internal {
        (bool success, ) = recipient.call{value: amount}("");
        require(success, "ETH transfer failed");
        if (hackathonId > 0) {
            emit PrizeDistributed(hackathonId, recipient, amount);
        }
    }

    // Internal function to remove hackathon from activeHackathons
    function _removeActiveHackathon(uint256 hackathonId) internal {
        for (uint256 i = 0; i < activeHackathons.length; i++) {
            if (activeHackathons[i] == hackathonId) {
                if (i != activeHackathons.length - 1) {
                    activeHackathons[i] = activeHackathons[activeHackathons.length - 1];
                }
                activeHackathons.pop();
                break;
            }
        }
    }

    receive() external payable {}
}